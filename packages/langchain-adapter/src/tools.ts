/**
 * @arclayer/langchain-adapter — LangChain tool wrappers.
 *
 * Creates LangChain tool() instances that call ArcLayer Runner via HMAC-authed HTTP.
 * All tools go through the Runner HTTP surface — no direct Circle CLI, no internal imports.
 */

import { tool, type DynamicStructuredTool } from "langchain";
import { z } from "zod";
import { Erc8183ProviderJobSchema } from "@arclayer/runner-core";
import { ArcLayerRunnerClient } from "./client.js";
import { getArcLayerToolsForRole } from "./roles.js";
import { TOOL_NAME_MAP } from "./tool-map.js";
import { ArcLayerPolicyError, ArcLayerToolDeniedError } from "./errors.js";
import { sanitizeErrorMessage } from "./redaction.js";
import type {
  CreateArcLayerLangChainToolsOptions,
  ArcLayerAgentRole,
  ArcLayerLogger,
} from "./types.js";

// ── Zod Schemas ─────────────────────────────────────────────────────────────

/**
 * Provider run input schema — reuses Erc8183ProviderJobSchema from runner-core
 * to avoid schema drift. Adds .describe() for LangChain tool parameter hints.
 */
const ProviderRunInputSchema = Erc8183ProviderJobSchema.extend({
  taskId: Erc8183ProviderJobSchema.shape.taskId.describe("Task identifier"),
  jobId: Erc8183ProviderJobSchema.shape.jobId.describe(
    "ERC-8183 job ID (numeric string)",
  ),
  agentId: Erc8183ProviderJobSchema.shape.agentId.describe("Agent identifier"),
  provider: Erc8183ProviderJobSchema.shape.provider.describe(
    "Provider wallet address (0x...)",
  ),
  evaluator: Erc8183ProviderJobSchema.shape.evaluator?.describe(
    "Evaluator wallet address (0x..., optional)",
  ),
  description: Erc8183ProviderJobSchema.shape.description.describe(
    "Job description",
  ),
  input: Erc8183ProviderJobSchema.shape.input.describe(
    "Job input payload (any JSON value)",
  ),
  metadata: Erc8183ProviderJobSchema.shape.metadata.describe(
    "Optional metadata key-value pairs",
  ),
});

const LimitInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of records to return (1-100)"),
});

const X402InspectInputSchema = z.object({
  url: z.string().url().describe("URL of the x402-protected resource"),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
    .optional()
    .default("GET")
    .describe("HTTP method"),
  body: z.unknown().optional().describe("Request body (for POST/PUT/PATCH)"),
});

const X402PayInputSchema = z.object({
  url: z.string().url().describe("URL of the x402-protected resource"),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
    .optional()
    .default("GET")
    .describe("HTTP method"),
  maxAmountUsdc: z
    .string()
    .regex(/^[0-9]+(\.[0-9]+)?$/, "Must be a decimal string")
    .describe("Maximum amount in USDC to pay"),
  reason: z
    .string()
    .min(1)
    .describe("Reason for this payment (required for audit)"),
  idempotencyKey: z
    .string()
    .optional()
    .describe("Idempotency key to prevent duplicate payments"),
  body: z.unknown().optional().describe("Request body (for POST/PUT/PATCH)"),
});

const X402BatchPayInputSchema = z.object({
  batchId: z.string().min(1).describe("Unique batch identifier"),
  taskId: z.string().min(1).describe("Task identifier for this batch"),
  payments: z
    .array(
      z.object({
        url: z.string().url().describe("URL of the x402-protected resource"),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .optional()
          .default("GET")
          .describe("HTTP method"),
        maxAmountUsdc: z
          .string()
          .regex(/^[0-9]+(\.[0-9]+)?$/, "Must be a decimal string")
          .describe("Maximum amount in USDC"),
        reason: z.string().min(1).describe("Reason for this payment"),
        idempotencyKey: z.string().optional().describe("Idempotency key"),
        body: z.unknown().optional().describe("Request body"),
      }),
    )
    .min(1)
    .describe("List of payments to execute"),
});

// ── Host Validation ─────────────────────────────────────────────────────────

function normalizeHost(value: string): string {
  return value.trim().toLowerCase();
}

function validateHost(
  url: string,
  allowedHosts?: string[],
  deniedHosts?: string[],
): void {
  let host: string;
  try {
    // Match Runner policy: URL.host includes the port for non-default ports.
    host = normalizeHost(new URL(url).host);
  } catch {
    throw new ArcLayerPolicyError(`Invalid URL: ${url}`);
  }

  const normalizedDeniedHosts = deniedHosts?.map(normalizeHost) ?? [];
  const normalizedAllowedHosts = allowedHosts?.map(normalizeHost) ?? [];

  if (
    normalizedDeniedHosts.includes("*") ||
    normalizedDeniedHosts.includes(host)
  ) {
    throw new ArcLayerPolicyError(`Host '${host}' is denied`);
  }

  if (
    normalizedAllowedHosts.length > 0 &&
    !normalizedAllowedHosts.includes("*") &&
    !normalizedAllowedHosts.includes(host)
  ) {
    throw new ArcLayerPolicyError(
      `Host '${host}' is not in allowed hosts: ${allowedHosts?.join(", ")}`,
    );
  }
}

function assertUniqueBatchIdempotencyKeys(
  payments: Array<{ idempotencyKey?: string }>,
): void {
  const seen = new Set<string>();
  for (const payment of payments) {
    const key = payment.idempotencyKey?.trim();
    if (!key) continue;
    if (seen.has(key)) {
      throw new ArcLayerPolicyError(
        `Duplicate idempotencyKey in batch: ${key}`,
      );
    }
    seen.add(key);
  }
}

// ── Amount Validation ───────────────────────────────────────────────────────

function assertAmountWithinSdkLimit(
  amount: string,
  maxAmountUsdc: string,
): void {
  const amountNum = parseFloat(amount);
  const maxNum = parseFloat(maxAmountUsdc);
  if (isNaN(amountNum) || isNaN(maxNum)) {
    throw new ArcLayerPolicyError("Invalid amount format");
  }
  if (amountNum > maxNum) {
    throw new ArcLayerPolicyError(
      `Amount ${amount} USDC exceeds SDK limit of ${maxAmountUsdc} USDC`,
    );
  }
}

// ── Normalize Result ────────────────────────────────────────────────────────

function normalizeToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

// ── Tool Factory ────────────────────────────────────────────────────────────

/**
 * Create LangChain tools for an ArcLayer agent role.
 *
 * Tools are filtered by role preset, then by allowedTools/deniedTools overrides.
 * Payment tools apply SDK-side guardrails (maxAmountUsdc, host allowlist).
 */
export function createArcLayerLangChainTools(
  options: CreateArcLayerLangChainToolsOptions,
): DynamicStructuredTool[] {
  const {
    runnerUrl,
    runnerSecret,
    role = "read-only",
    allowedTools,
    deniedTools,
    maxAmountUsdc,
    allowedHosts,
    deniedHosts,
    requireIdempotencyKey = false,
    timeoutMs,
    logger,
  } = options;

  // Validate role
  const enabledTools = getArcLayerToolsForRole(role, {
    allowedTools,
    deniedTools,
  });

  const client = new ArcLayerRunnerClient({
    runnerUrl,
    runnerSecret,
    timeoutMs,
    fetchImpl: options.fetchImpl,
  });

  const tools: DynamicStructuredTool[] = [];

  for (const toolName of enabledTools) {
    const entry = TOOL_NAME_MAP[toolName];
    if (!entry) {
      logger?.warn?.(`Unknown tool in role preset: ${toolName}`);
      continue;
    }

    switch (toolName) {
      case "arclayer_x402_inspect":
        tools.push(createInspectTool(client, toolName, entry, {
          allowedHosts,
          deniedHosts,
          logger,
        }));
        break;

      case "arclayer_x402_pay":
        tools.push(createPayTool(client, toolName, entry, {
          maxAmountUsdc,
          allowedHosts,
          deniedHosts,
          requireIdempotencyKey,
          logger,
        }));
        break;

      case "arclayer_x402_batch_pay":
        // Only enable batch pay for x402-agent
        if (role === "x402-agent") {
          tools.push(createBatchPayTool(client, toolName, entry, {
            maxAmountUsdc,
            allowedHosts,
            deniedHosts,
            requireIdempotencyKey,
            logger,
          }));
        }
        break;

      case "arclayer_receipts":
        tools.push(createReceiptsTool(client, toolName, entry, { logger }));
        break;

      case "arclayer_spend_ledger":
        tools.push(createLedgerTool(client, toolName, entry, { logger }));
        break;

      case "arclayer_provider_run_only":
        tools.push(
          createProviderRunOnlyTool(client, toolName, entry, { logger }),
        );
        break;

      case "arclayer_provider_run_and_submit":
        tools.push(
          createProviderRunAndSubmitTool(client, toolName, entry, { logger }),
        );
        break;

      default:
        logger?.warn?.(`No tool implementation for: ${toolName}`);
    }
  }

  return tools;
}

// ── Individual Tool Creators ─────────────────────────────────────────────────

function createInspectTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { allowedHosts?: string[]; deniedHosts?: string[]; logger?: ArcLayerLogger },
) {
  return tool(
    async (input) => {
      try {
        validateHost(input.url, opts.allowedHosts, opts.deniedHosts);
        const result = await client.inspectX402({
          url: input.url,
          method: input.method,
          body: input.body,
        });
        return normalizeToolResult(result);
      } catch (e: unknown) {
        const msg = sanitizeErrorMessage(
          e instanceof Error ? e.message : String(e),
        );
        return `Error: ${msg}`;
      }
    },
    {
      name: toolName,
      description:
        "Inspect an x402-protected resource through ArcLayer Runner. Returns payment requirements without executing payment. Read-only operation.",
      schema: X402InspectInputSchema,
    },
  );
}

function createPayTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: {
    maxAmountUsdc?: string;
    allowedHosts?: string[];
    deniedHosts?: string[];
    requireIdempotencyKey?: boolean;
    logger?: ArcLayerLogger;
  },
) {
  return tool(
    async (input) => {
      try {
        validateHost(input.url, opts.allowedHosts, opts.deniedHosts);

        // SDK-side maxAmountUsdc guard
        if (opts.maxAmountUsdc) {
          assertAmountWithinSdkLimit(input.maxAmountUsdc, opts.maxAmountUsdc);
        }

        // Idempotency key guard
        if (opts.requireIdempotencyKey && !input.idempotencyKey) {
          throw new ArcLayerPolicyError(
            "idempotencyKey is required by SDK configuration",
          );
        }

        const result = await client.payX402({
          url: input.url,
          method: input.method,
          maxAmountUsdc: input.maxAmountUsdc,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          body: input.body,
        });
        return normalizeToolResult(result);
      } catch (e: unknown) {
        const msg = sanitizeErrorMessage(
          e instanceof Error ? e.message : String(e),
        );
        return `Error: ${msg}`;
      }
    },
    {
      name: toolName,
      description:
        "Pay an x402-protected resource through ArcLayer Runner. Runner enforces wallet policy, spend limits, receipts, and ledger. Always provide a reason.",
      schema: X402PayInputSchema,
    },
  );
}

function createBatchPayTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: {
    maxAmountUsdc?: string;
    allowedHosts?: string[];
    deniedHosts?: string[];
    requireIdempotencyKey?: boolean;
    logger?: ArcLayerLogger;
  },
) {
  return tool(
    async (input) => {
      try {
        // Validate all hosts
        for (const p of input.payments) {
          validateHost(p.url, opts.allowedHosts, opts.deniedHosts);
          if (opts.maxAmountUsdc) {
            assertAmountWithinSdkLimit(p.maxAmountUsdc, opts.maxAmountUsdc);
          }
          if (opts.requireIdempotencyKey && !p.idempotencyKey) {
            throw new ArcLayerPolicyError(
              "idempotencyKey is required for each payment by SDK configuration",
            );
          }
        }

        assertUniqueBatchIdempotencyKeys(input.payments);

        const result = await client.batchPayX402({
          batchId: input.batchId,
          taskId: input.taskId,
          payments: input.payments,
        });
        return normalizeToolResult(result);
      } catch (e: unknown) {
        const msg = sanitizeErrorMessage(
          e instanceof Error ? e.message : String(e),
        );
        return `Error: ${msg}`;
      }
    },
    {
      name: toolName,
      description:
        "Batch pay multiple x402-protected resources through ArcLayer Runner. Each payment is individually policy-checked. Always provide a reason for each payment.",
      schema: X402BatchPayInputSchema,
    },
  );
}

function createReceiptsTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { logger?: ArcLayerLogger },
) {
  return tool(
    async (input) => {
      try {
        const result = await client.listReceipts(input.limit);
        return normalizeToolResult(result);
      } catch (e: unknown) {
        const msg = sanitizeErrorMessage(
          e instanceof Error ? e.message : String(e),
        );
        return `Error: ${msg}`;
      }
    },
    {
      name: toolName,
      description:
        "List recent payment receipts from ArcLayer Runner. Returns receipt records with amounts, URLs, tx hashes, and settlement status.",
      schema: LimitInputSchema,
    },
  );
}

function createLedgerTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { logger?: ArcLayerLogger },
) {
  return tool(
    async (input) => {
      try {
        const result = await client.listLedger(input.limit);
        return normalizeToolResult(result);
      } catch (e: unknown) {
        const msg = sanitizeErrorMessage(
          e instanceof Error ? e.message : String(e),
        );
        return `Error: ${msg}`;
      }
    },
    {
      name: toolName,
      description:
        "List recent spending ledger records from ArcLayer Runner. Shows all payment attempts, successes, and failures.",
      schema: LimitInputSchema,
    },
  );
}

function createProviderRunOnlyTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { logger?: ArcLayerLogger },
) {
  return tool(
    async (input) => {
      try {
        const result = await client.runProviderJobOnly({
          taskId: input.taskId,
          jobId: input.jobId,
          agentId: input.agentId,
          provider: input.provider,
          evaluator: input.evaluator,
          description: input.description,
          input: input.input,
          metadata: input.metadata,
        });
        return normalizeToolResult(result);
      } catch (e: unknown) {
        const msg = sanitizeErrorMessage(
          e instanceof Error ? e.message : String(e),
        );
        return `Error: ${msg}`;
      }
    },
    {
      name: toolName,
      description:
        "Run an ERC-8183 provider job through ArcLayer Runner (runtime only, no on-chain submit). " +
        "Dispatches the job to the configured LLM runtime and returns the result + deliverableHash. " +
        "Use this as the default provider execution path. " +
        "The deliverable is NOT submitted on-chain — use arclayer_provider_run_and_submit for that.",
      schema: ProviderRunInputSchema,
    },
  );
}

function createProviderRunAndSubmitTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { logger?: ArcLayerLogger },
) {
  return tool(
    async (input) => {
      try {
        const result = await client.runAndSubmitProviderJob({
          taskId: input.taskId,
          jobId: input.jobId,
          agentId: input.agentId,
          provider: input.provider,
          evaluator: input.evaluator,
          description: input.description,
          input: input.input,
          metadata: input.metadata,
        });
        return normalizeToolResult(result);
      } catch (e: unknown) {
        const msg = sanitizeErrorMessage(
          e instanceof Error ? e.message : String(e),
        );
        return `Error: ${msg}`;
      }
    },
    {
      name: toolName,
      description:
        "Run an ERC-8183 provider job AND submit the deliverable on-chain through ArcLayer Runner. " +
        "This is the full lifecycle: runtime execution + Circle CLI submit. " +
        "Only use when on-chain settlement is explicitly required. " +
        "For runtime-only execution, prefer arclayer_provider_run_only.",
      schema: ProviderRunInputSchema,
    },
  );
}
