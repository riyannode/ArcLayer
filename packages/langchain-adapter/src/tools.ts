/**
 * @arclayer/langchain-adapter — LangChain tool wrappers.
 *
 * Creates LangChain tool() instances that call ArcLayer Runner via HMAC-authed HTTP.
 * All tools go through the Runner HTTP surface — no direct wallet tooling calls, no internal imports.
 *
 * Exception: adapterOnly tools (e.g. erc8183_provider_quote_job) compute locally
 * and do not make Runner HTTP calls.
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
  ProviderPricingPolicy,
} from "./types.js";
import { DEFAULT_PROVIDER_PRICING_POLICY } from "./types.js";

// ── USDC Precision ─────────────────────────────────────────────────────

const USDC_DECIMAL_6_REGEX = /^[0-9]+(\.[0-9]{1,6})?$/;

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

/**
 * Provider quote job input — adapter-only, no Runner call.
 */
const ProviderQuoteInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string").describe("ERC-8183 job ID (numeric string)"),
  description: z.string().min(1).describe("Job description for complexity assessment"),
  input: z.unknown().refine(
    (v) => v !== undefined,
    { message: "input is required (must be a JSON value, not undefined)" },
  ).describe("Job input payload"),
  complexityHint: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe("Hint for complexity assessment: low (1 USDC), medium (3 USDC), high (5 USDC)"),
  reason: z
    .string()
    .optional()
    .describe("Optional model-provided reasoning for complexity assessment"),
});

/**
 * Provider set budget input — calls Runner over HMAC.
 * Reason is required and will be encoded into on-chain optParams.
 */
const ProviderSetBudgetInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string").describe("ERC-8183 job ID (numeric string)"),
  amount: z
    .string()
    .regex(USDC_DECIMAL_6_REGEX, "Must be a decimal string with at most 6 fractional digits")
    .describe("Budget amount in USDC (max 5.00)"),
  complexity: z
    .enum(["low", "medium", "high"])
    .describe("Job complexity level: low (1 USDC), medium (3 USDC), high (5 USDC)"),
  reason: z
    .string()
    .min(1, "reason is required")
    .max(512, "reason must be 512 characters or fewer")
    .describe("Pricing reason — will be encoded into on-chain calldata (do not include secrets)"),
});

// ── Provider Runtime Proxy Schemas ──────────────────────────────────────────

/** Generic schema for provider runtime proxy tools that accept a JSON body. */
const ProviderProxyInputSchema = z.object({}).passthrough().describe("Tool-specific input (passed through to Console MCP)");

/** Schema for erc8183_provider_write_checkpoint — Console MCP requires agentId, jobId, phase, status. */
const ProviderWriteCheckpointInputSchema = z.object({
  agentId: z.string().min(1).describe("Agent identifier"),
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string").describe("ERC-8183 job ID"),
  phase: z.string().min(1).describe("Checkpoint phase (e.g. 'executing', 'deliverable_ready')"),
  status: z.string().min(1).describe("Checkpoint status (e.g. 'in_progress', 'completed')"),
  runId: z.string().optional().describe("Optional run ID"),
  txHash: z.string().optional().describe("Optional transaction hash"),
  deliverableHash: z.string().optional().describe("Optional deliverable hash"),
  payloadHash: z.string().optional().describe("Optional payload hash"),
  note: z.string().optional().describe("Optional human-readable note"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Optional metadata"),
});

/** Schema for erc8183_provider_publish_deliverable — Console MCP requires agentId, jobId, providerAddress, canonicalPayload, deliverableHash. */
const ProviderPublishDeliverableInputSchema = z.object({
  agentId: z.string().min(1).describe("Agent identifier"),
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string").describe("ERC-8183 job ID"),
  providerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid 0x address").describe("Provider wallet address"),
  canonicalPayload: z.string().min(1).describe("Canonical deliverable payload (server recomputes Keccak-256)"),
  deliverableHash: z.string().min(1).describe("Expected Keccak-256 hash of canonicalPayload (0x-prefixed, 66 chars)"),
  artifacts: z.array(z.unknown()).optional().describe("Optional artifacts array"),
  runtimeReceiptHash: z.string().optional().describe("Optional runtime receipt hash"),
});

/** Schema for erc8183_provider_submit_deliverable. */
const ProviderSubmitDeliverableInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string").describe("ERC-8183 job ID (numeric string)"),
  deliverableHash: z.string().min(1).describe("Keccak-256 hash of the deliverable (0x-prefixed, 66 chars)"),
});

/** Schema for erc8183_job_status. */
const JobStatusInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string").describe("ERC-8183 job ID (numeric string)"),
});

/** Schema for erc8183_job_lifecycle_summary. */
const JobLifecycleSummaryInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string").describe("ERC-8183 job ID (numeric string)"),
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

// ── Provider Pricing Helpers ────────────────────────────────────────────────

function resolvePricingPolicy(
  policy?: ProviderPricingPolicy,
): Required<ProviderPricingPolicy> {
  return {
    minBudgetUsdc: policy?.minBudgetUsdc ?? DEFAULT_PROVIDER_PRICING_POLICY.minBudgetUsdc,
    maxBudgetUsdc: policy?.maxBudgetUsdc ?? DEFAULT_PROVIDER_PRICING_POLICY.maxBudgetUsdc,
    lowComplexityBudgetUsdc: policy?.lowComplexityBudgetUsdc ?? DEFAULT_PROVIDER_PRICING_POLICY.lowComplexityBudgetUsdc,
    mediumComplexityBudgetUsdc: policy?.mediumComplexityBudgetUsdc ?? DEFAULT_PROVIDER_PRICING_POLICY.mediumComplexityBudgetUsdc,
    highComplexityBudgetUsdc: policy?.highComplexityBudgetUsdc ?? DEFAULT_PROVIDER_PRICING_POLICY.highComplexityBudgetUsdc,
    defaultBudgetUsdc: policy?.defaultBudgetUsdc ?? DEFAULT_PROVIDER_PRICING_POLICY.defaultBudgetUsdc,
  };
}

function classifyComplexity(description: string, input: unknown): "low" | "medium" | "high" {
  const inputStr = typeof input === "string" ? input : JSON.stringify(input ?? "");
  const totalLength = (description?.length ?? 0) + inputStr.length;

  if (totalLength > 2000) return "high";
  if (totalLength > 500) return "medium";
  return "low";
}

function mapComplexityToBudget(
  complexity: "low" | "medium" | "high",
  policy: Required<ProviderPricingPolicy>,
): string {
  switch (complexity) {
    case "low":
      return policy.lowComplexityBudgetUsdc;
    case "medium":
      return policy.mediumComplexityBudgetUsdc;
    case "high":
      return policy.highComplexityBudgetUsdc;
  }
}

function parseUsdcMicros(amount: string): bigint {
  if (!USDC_DECIMAL_6_REGEX.test(amount)) {
    throw new ArcLayerPolicyError(
      "amount must be a decimal string with at most 6 fractional digits",
    );
  }
  const [whole, fraction = ""] = amount.split(".");
  const micros = `${whole}${fraction.padEnd(6, "0")}`;
  return BigInt(micros);
}

function assertPositiveUsdcAmount(amount: string): bigint {
  const micros = parseUsdcMicros(amount);
  if (micros <= 0n) {
    throw new ArcLayerPolicyError("amount must be greater than 0");
  }
  return micros;
}

function clampBudgetToPolicyMax(
  suggestedBudgetUsdc: string,
  policy: Required<ProviderPricingPolicy>,
): string {
  const suggestedMicros = parseUsdcMicros(suggestedBudgetUsdc);
  const maxMicros = parseUsdcMicros(policy.maxBudgetUsdc);
  if (suggestedMicros > maxMicros) {
    return policy.maxBudgetUsdc;
  }
  return suggestedBudgetUsdc;
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
 * Provider pricing tools apply budget policy guardrails.
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
    enableProviderRunAndSubmit = false,
    enableProviderSetBudget = false,
    enableProviderPublishDeliverable = false,
    enableProviderSubmitDeliverable = false,
    providerPricingPolicy,
    timeoutMs,
    logger,
  } = options;

  // Validate role
  const enabledTools = getArcLayerToolsForRole(role, {
    allowedTools,
    deniedTools,
    enableProviderRunAndSubmit,
    enableProviderSetBudget,
    enableProviderPublishDeliverable,
    enableProviderSubmitDeliverable,
  });

  const client = new ArcLayerRunnerClient({
    runnerUrl,
    runnerSecret,
    timeoutMs,
    fetchImpl: options.fetchImpl,
  });

  const pricingPolicy = resolvePricingPolicy(providerPricingPolicy);
  const tools: DynamicStructuredTool[] = [];

  for (const toolName of enabledTools) {
    const entry = TOOL_NAME_MAP[toolName];
    if (!entry) {
      logger?.warn?.(`Unknown tool in role preset: ${toolName}`);
      continue;
    }

    switch (toolName) {
      case "x402_inspect":
        tools.push(createInspectTool(client, toolName, entry, {
          allowedHosts,
          deniedHosts,
          logger,
        }));
        break;

      case "x402_pay":
        tools.push(createPayTool(client, toolName, entry, {
          maxAmountUsdc,
          allowedHosts,
          deniedHosts,
          requireIdempotencyKey,
          logger,
        }));
        break;

      case "x402_batch_pay":
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

      case "payment_receipts":
        tools.push(createReceiptsTool(client, toolName, entry, { logger }));
        break;

      case "payment_spend_ledger":
        tools.push(createLedgerTool(client, toolName, entry, { logger }));
        break;

      case "erc8183_provider_run_only":
        tools.push(
          createProviderRunOnlyTool(client, toolName, entry, { logger }),
        );
        break;

      case "erc8183_provider_run_and_submit":
        tools.push(
          createProviderRunAndSubmitTool(client, toolName, entry, { logger }),
        );
        break;

      case "erc8183_provider_quote_job":
        // Adapter-only: no Runner call, no HMAC, pure local compute
        tools.push(
          createProviderQuoteJobTool(toolName, entry, {
            pricingPolicy,
            logger,
          }),
        );
        break;

      case "erc8183_provider_set_budget":
        tools.push(
          createProviderSetBudgetTool(client, toolName, entry, {
            pricingPolicy,
            logger,
          }),
        );
        break;

      // ── Provider Runtime (Console MCP proxy) ──────────────────────
      case "erc8183_provider_get_context":
      case "erc8183_provider_get_resume_plan":
      case "erc8183_provider_heartbeat":
      case "erc8183_provider_start_job":
      case "erc8183_provider_retry_job":
      case "erc8183_provider_complete_run":
      case "erc8183_provider_list_assigned_jobs":
      case "erc8183_provider_list_assigned_jobs_extended":
      case "erc8183_provider_list_open_jobs":
      case "erc8183_provider_list_my_open_job_applications":
      case "erc8183_provider_apply_open_job":
      case "erc8183_provider_withdraw_open_job_application":
        tools.push(createProviderProxyTool(client, toolName, entry, { logger }));
        break;

      case "erc8183_provider_write_checkpoint":
        tools.push(createProviderWriteCheckpointTool(client, toolName, entry, { logger }));
        break;

      case "erc8183_provider_publish_deliverable":
        tools.push(createProviderPublishDeliverableTool(client, toolName, entry, { logger }));
        break;

      case "erc8183_provider_submit_deliverable":
        tools.push(createProviderSubmitDeliverableTool(client, toolName, entry, { logger }));
        break;

      case "erc8183_job_status":
        tools.push(createJobStatusTool(client, toolName, entry, { logger }));
        break;

      case "erc8183_job_lifecycle_summary":
        tools.push(createJobLifecycleSummaryTool(client, toolName, entry, { logger }));
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
        "The deliverable is NOT submitted on-chain — use erc8183_provider_run_and_submit for that.",
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
        "This is the full lifecycle: runtime execution + wallet-adapter on-chain submit through ArcLayer Runner. " +
        "Only use when on-chain settlement is explicitly required. " +
        "For runtime-only execution, prefer erc8183_provider_run_only.",
      schema: ProviderRunInputSchema,
    },
  );
}

// ── Provider Pricing Tools ──────────────────────────────────────────────────

/**
 * Create an adapter-only quote job tool.
 * No Runner call, no HMAC, no wallet tooling.
 * Pure complexity → budget mapping using the pricing policy.
 */
function createProviderQuoteJobTool(
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: {
    pricingPolicy: Required<ProviderPricingPolicy>;
    logger?: ArcLayerLogger;
  },
) {
  return tool(
    async (input) => {
      try {
        const complexity = input.complexityHint
          ?? classifyComplexity(input.description, input.input);

        const rawSuggestedBudgetUsdc = mapComplexityToBudget(complexity, opts.pricingPolicy);
        const suggestedBudgetUsdc = clampBudgetToPolicyMax(
          rawSuggestedBudgetUsdc,
          opts.pricingPolicy,
        );

        const reason = input.reason
          ?? `${complexity.charAt(0).toUpperCase() + complexity.slice(1)} complexity job`;

        const output = {
          ok: true as const,
          jobId: input.jobId,
          complexity,
          suggestedBudgetUsdc,
          maxBudgetUsdc: opts.pricingPolicy.maxBudgetUsdc,
          reason,
        };

        return normalizeToolResult(output);
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
        "Quote the complexity and suggested budget for an ERC-8183 provider job. " +
        "This is an adapter-only tool — no on-chain call, no Runner call. " +
        "Use this BEFORE calling erc8183_provider_set_budget. " +
        "Returns complexity (low/medium/high), suggestedBudgetUsdc, maxBudgetUsdc, and reason. " +
        "Complexity mapping: low = 1 USDC, medium = 3 USDC, high = 5 USDC. " +
        "Max budget is hard capped at 5.00 USDC.",
      schema: ProviderQuoteInputSchema,
    },
  );
}

/**
 * Create a provider set-budget tool.
 * Calls Runner over HMAC. SDK-side budget policy guardrails applied before network call.
 * Reason is required and will be encoded into on-chain optParams by the Runner.
 */
function createProviderSetBudgetTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: {
    pricingPolicy: Required<ProviderPricingPolicy>;
    logger?: ArcLayerLogger;
  },
) {
  const hardCapMicros = parseUsdcMicros(DEFAULT_PROVIDER_PRICING_POLICY.maxBudgetUsdc);

  return tool(
    async (input) => {
      try {
        // SDK-side validation: amount > 0 and max 6 fractional digits
        const amountMicros = assertPositiveUsdcAmount(input.amount);

        // SDK-side validation: amount <= maxBudgetUsdc from policy
        const policyMaxMicros = parseUsdcMicros(opts.pricingPolicy.maxBudgetUsdc);
        if (amountMicros > policyMaxMicros) {
          throw new ArcLayerPolicyError(
            `amount ${input.amount} USDC exceeds policy maximum of ${opts.pricingPolicy.maxBudgetUsdc} USDC`,
          );
        }

        // SDK-side validation: hard cap 5.00
        if (amountMicros > hardCapMicros) {
          throw new ArcLayerPolicyError(
            `amount ${input.amount} USDC exceeds hard cap of ${DEFAULT_PROVIDER_PRICING_POLICY.maxBudgetUsdc} USDC`,
          );
        }

        // SDK-side validation: amount >= minBudgetUsdc
        const policyMinMicros = parseUsdcMicros(opts.pricingPolicy.minBudgetUsdc);
        if (amountMicros < policyMinMicros) {
          throw new ArcLayerPolicyError(
            `amount ${input.amount} USDC is below policy minimum of ${opts.pricingPolicy.minBudgetUsdc} USDC`,
          );
        }

        // Call Runner over HMAC
        const raw = await client.setProviderBudget({
          jobId: input.jobId,
          amount: input.amount,
          complexity: input.complexity,
          reason: input.reason,
        });

        // Map to readable output
        const output = {
          ok: raw.ok,
          jobId: input.jobId,
          amount: input.amount,
          complexity: input.complexity,
          reason: input.reason,
          status: raw.ok ? "submitted" : "failed",
          txHash: raw.txHash,
          receipt: raw.receipt,
          raw,
        };

        return normalizeToolResult(output);
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
        "Set the budget for an ERC-8183 provider job through ArcLayer Runner. " +
        "This is an on-chain write — calls setBudget(jobId, amount, optParams) on the ERC-8183 contract. " +
        "A reason is required and will be encoded into on-chain calldata (optParams). " +
        "Do not include secrets, private prompts, API keys, or customer private data in the reason. " +
        "Max budget is hard capped at 5.00 USDC. " +
        "Use erc8183_provider_quote_job first to assess complexity and get a suggested budget.",
      schema: ProviderSetBudgetInputSchema,
    },
  );
}

// ── Provider Runtime Proxy Tool Creator ─────────────────────────────────────

/**
 * Tool descriptions for provider proxy tools.
 * Each maps the erc8183_* name to a human-readable description.
 */
const PROVIDER_PROXY_DESCRIPTIONS: Record<string, string> = {
  erc8183_provider_get_context:
    "Get provider runtime context: state, active run, checkpoint, applications, and resume plan. " +
    "Pass { agentId }.",
  erc8183_provider_get_resume_plan:
    "Get the resume plan for a provider run — computes the next action from checkpoint and on-chain state. " +
    "Pass { agentId, runId?, jobId? }.",
  erc8183_provider_heartbeat:
    "Send a provider heartbeat — updates last_seen_at for the provider agent. " +
    "Pass { agentId }.",
  erc8183_provider_start_job:
    "Start a provider job run — creates a durable runtime entry for the job. " +
    "Idempotent on (agentId, jobId). Pass { agentId, jobId, taskId, ... }.",
  erc8183_provider_retry_job:
    "Retry a failed provider job run — max 3 retries. " +
    "Phase must be 'runtime_failed' or 'submit_tx_failed'. Pass { agentId, jobId }.",
  erc8183_provider_complete_run:
    "Mark a provider runtime run as completed — terminal cleanup. " +
    "Pass { agentId, jobId, runId?, status }.",
  erc8183_provider_list_assigned_jobs:
    "List jobs assigned to the provider address. " +
    "Pass { agentId, providerAddress, limit? }.",
  erc8183_provider_list_assigned_jobs_extended:
    "List assigned jobs with extended status filtering (Open/Funded/Submitted). " +
    "Pass { agentId, providerAddress, status?, limit? }.",
  erc8183_provider_list_open_jobs:
    "List open/global jobs where provider = address(0). " +
    "Pass { agentId, limit?, minBudgetUsdc?, includeExpired? }.",
  erc8183_provider_list_my_open_job_applications:
    "List the provider's open job applications. " +
    "Pass { agentId, status? }.",
  erc8183_provider_apply_open_job:
    "Apply for an open/global job as a provider. " +
    "Pass { agentId, jobId, providerAddress, quoteAmountUsdc?, quoteAmountAtomic?, message?, capabilities?, metadata? }.",
  erc8183_provider_withdraw_open_job_application:
    "Withdraw an open job application. " +
    "Pass { agentId, jobId }.",
};

/**
 * Create a generic provider proxy tool.
 * These tools forward directly to Console MCP via Runner proxy.
 */
function createProviderProxyTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { logger?: ArcLayerLogger },
) {
  const description = PROVIDER_PROXY_DESCRIPTIONS[toolName]
    ?? `Provider proxy tool: ${toolName}. Pass tool-specific input as JSON.`;

  return tool(
    async (input) => {
      try {
        const result = await client.post(entry.runnerPath, input ?? {});
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
      description,
      schema: ProviderProxyInputSchema,
    },
  );
}

/**
 * Create the provider write checkpoint tool (dedicated schema).
 * Calls Runner POST /provider/write-checkpoint (proxied to Console MCP).
 */
function createProviderWriteCheckpointTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { logger?: ArcLayerLogger },
) {
  return tool(
    async (input) => {
      try {
        const result = await client.post(entry.runnerPath, input);
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
        "Write a provider runtime checkpoint — append-only progress record for a running job. " +
        "Required: { agentId, jobId, phase, status }. " +
        "Optional: { runId, txHash, deliverableHash, payloadHash, note, metadata }. " +
        "Idempotent on provider:<agentId>:job:<jobId>:checkpoint:<phase>.",
      schema: ProviderWriteCheckpointInputSchema,
    },
  );
}

/**
 * Create the provider publish deliverable tool (dedicated schema).
 * Calls Runner POST /provider/publish-deliverable (proxied to Console MCP).
 */
function createProviderPublishDeliverableTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { logger?: ArcLayerLogger },
) {
  return tool(
    async (input) => {
      try {
        const result = await client.post(entry.runnerPath, input);
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
        "Publish the canonical deliverable for a funded job. " +
        "Server recomputes Keccak-256 hash from canonicalPayload and verifies on-chain provider/status. " +
        "Required: { agentId, jobId, providerAddress, canonicalPayload, deliverableHash }. " +
        "Optional: { artifacts, runtimeReceiptHash }. " +
        "Idempotent — provider can re-publish until submit locks it.",
      schema: ProviderPublishDeliverableInputSchema,
    },
  );
}

/**
 * Create the provider submit deliverable tool.
 * Calls Runner POST /erc8183/provider/submit-deliverable.
 */
function createProviderSubmitDeliverableTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { logger?: ArcLayerLogger },
) {
  return tool(
    async (input) => {
      try {
        const result = await client.providerSubmitDeliverable({
          jobId: input.jobId,
          deliverableHash: input.deliverableHash,
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
        "Submit a deliverable on-chain via the Runner wallet adapter. " +
        "This is a direct on-chain write — submit(jobId, deliverableHash, optParams). " +
        "Only use when the deliverable hash is already computed. " +
        "For the full lifecycle (run + submit), prefer erc8183_provider_run_and_submit.",
      schema: ProviderSubmitDeliverableInputSchema,
    },
  );
}

/**
 * Create the job status tool.
 * Calls Runner POST /jobs/onchain-status (proxied to Console MCP).
 */
function createJobStatusTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { logger?: ArcLayerLogger },
) {
  return tool(
    async (input) => {
      try {
        const result = await client.getJobStatus({ jobId: input.jobId });
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
        "Get the on-chain status of an ERC-8183 job. " +
        "Returns current status, provider, evaluator, budget, and other on-chain fields.",
      schema: JobStatusInputSchema,
    },
  );
}

/**
 * Create the job lifecycle summary tool.
 * Calls Runner POST /jobs/lifecycle-summary (proxied to Console MCP).
 */
function createJobLifecycleSummaryTool(
  client: ArcLayerRunnerClient,
  toolName: string,
  entry: (typeof TOOL_NAME_MAP)[string],
  opts: { logger?: ArcLayerLogger },
) {
  return tool(
    async (input) => {
      try {
        const result = await client.getJobLifecycleSummary({ jobId: input.jobId });
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
        "Get the lifecycle summary of an ERC-8183 job — " +
        "computes next actor and next action from current on-chain status.",
      schema: JobLifecycleSummaryInputSchema,
    },
  );
}
