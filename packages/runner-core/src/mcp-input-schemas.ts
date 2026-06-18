/**
 * MCP Tool Input Schemas — single source of truth for tool input validation.
 *
 * These Zod schemas define the shape of arguments accepted by each MCP tool.
 * They are used by:
 * - mcp-schemas.ts: generates JSON Schema for tools/list (MCP protocol)
 * - mcp-broker.ts: validates args before execution (call-time validation)
 * - mcp-tools.ts: parses args into typed objects before passing to services
 *
 * Read-only introspection tools (runner.health, circle.status, etc.) have NO
 * input schema — they accept no arguments or only an optional `limit` number.
 * Only write/payment tools that touch the wallet adapter or on-chain state are covered.
 */

import { z } from "zod";

// ── Shared Optional Fields ──────────────────────────────────────────────

const OptionalIdempotencyFields = {
  idempotencyKey: z.string().min(1, "idempotencyKey must not be empty").optional(),
  requestId: z.string().min(1, "requestId must not be empty").optional(),
};

// ── USDC Precision Helpers ─────────────────────────────────────────────

const USDC_DECIMAL_6_REGEX = /^[0-9]+(\.[0-9]{1,6})?$/;

function parseUsdcMicrosForSchema(amount: string): bigint {
  if (!USDC_DECIMAL_6_REGEX.test(amount)) return 0n;
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(`${whole}${fraction.padEnd(6, "0")}`);
}

const UsdcAmountInputSchema = z
  .string()
  .regex(USDC_DECIMAL_6_REGEX, "amount must be a decimal string with at most 6 fractional digits")
  .refine(
    (amount) => parseUsdcMicrosForSchema(amount) > 0n,
    "amount must be greater than 0",
  );

// ── Individual Tool Input Schemas ─────────────────────────────────────────
// These schemas define the MCP tool input shape — what arrives from the client.
// Internal type literals (like `type: "x402_service_pay"`) are NOT included;
// mcp-tools.ts adds them before passing to services.

/** x402.pay — pay an x402 service */
export const X402PayInputSchema = z.object({
  url: z.string().url("Invalid URL"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  maxAmountUsdc: z.string().regex(/^[0-9]+(\.[0-9]+)?$/, "maxAmountUsdc must be a decimal string"),
  reason: z.string().min(1, "reason is required"),
  idempotencyKey: z.string().optional(),
  body: z.unknown().optional(),
});

/** x402.batch_pay — batch pay multiple x402 services */
export const X402BatchPayInputSchema = z.object({
  batchId: z.string().min(1, "batchId is required"),
  taskId: z.string().min(1, "taskId is required"),
  payments: z.array(z.object({
    url: z.string().url("Invalid URL"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    maxAmountUsdc: z.string().regex(/^[0-9]+(\.[0-9]+)?$/, "maxAmountUsdc must be a decimal string"),
    reason: z.string().min(1, "reason is required"),
    idempotencyKey: z.string().optional(),
    body: z.unknown().optional(),
  })).min(1, "At least one payment is required"),
});

/** x402.inspect — inspect x402 service (read-only, no payment) */
export const X402InspectInputSchema = z.object({
  url: z.string().url("Invalid URL"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  body: z.unknown().optional(),
});

/** erc8004.prepare_register — prepare unsigned calldata for agent registration */
export const Erc8004PrepareRegisterInputSchema = z.object({
  metadataURI: z.string().min(1, "metadataURI is required").url("Invalid URL"),
});

/** erc8004.register_execute — register identity on-chain */
export const Erc8004RegisterExecuteInputSchema = z.object({
  metadataURI: z.string().min(1, "metadataURI is required").url("Invalid URL"),
});

/** erc8183.provider_run_job — dispatch job to runtime (no on-chain submit) */
export const Erc8183ProviderRunJobInputSchema = z.object({
  taskId: z.string().min(1, "taskId is required"),
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string"),
  agentId: z.string().min(1, "agentId is required"),
  provider: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "provider must be a valid address"),
  description: z.string().min(1, "description is required"),
  // Reject undefined (missing input) while permitting any JSON value.
  // z.unknown() alone accepts undefined — the refine catches it.
  input: z.unknown().refine(
    (v) => v !== undefined,
    { message: "input is required (must be a JSON value, not undefined)" }
  ),
});

/** erc8183.provider_submit_deliverable — submit deliverable on-chain */
export const Erc8183ProviderSubmitDeliverableInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string"),
  // Accept both 0x-prefixed (66 chars) and bare hex (64 chars).
  // Handler normalizes to 0x-prefixed before calling the service.
  deliverableHash: z.string().regex(
    /^(0x)?[a-fA-F0-9]{64}$/,
    "deliverableHash must be 64 hex chars, optionally 0x-prefixed"
  ),
});

/** erc8183.provider_run_and_submit — full lifecycle: run + submit */
export const Erc8183ProviderRunAndSubmitInputSchema = Erc8183ProviderRunJobInputSchema;

/** erc8183.create_job — create ERC-8183 job on-chain */
export const Erc8183CreateJobInputSchema = z.object({
  provider: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "provider must be a valid address"),
  evaluator: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "evaluator must be a valid address"),
  expiredAt: z.union([z.string(), z.number()]).refine(
    (v) => {
      const n = typeof v === "string" ? Number(v) : v;
      return !isNaN(n) && n > 0;
    },
    { message: "expiredAt must be a positive number (unix timestamp)" }
  ),
  description: z.string().min(1, "description is required"),
  hook: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "hook must be a valid address").optional(),
  ...OptionalIdempotencyFields,
});

/** erc8183.set_budget — set budget for a job */
export const Erc8183SetBudgetInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string"),
  amount: UsdcAmountInputSchema,
  optParams: z.string().regex(/^0x[0-9a-fA-F]*$/, "optParams must be hex bytes").optional(),
  complexity: z.enum(["low", "medium", "high"]).optional(),
  reason: z.string().min(1).max(512).optional(),
}).superRefine((value, ctx) => {
  const hasReasonFields = Boolean(value.reason || value.complexity);

  if (hasReasonFields && value.optParams) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either optParams or reason+complexity, not both",
      path: ["optParams"],
    });
  }

  if (hasReasonFields && (!value.reason || !value.complexity)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Both reason and complexity are required when encoding provider budget reason",
      path: ["reason"],
    });
  }
});

/** erc8183.approve_usdc — approve USDC for AgenticCommerce */
export const Erc8183ApproveUsdcInputSchema = z.object({
  amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/, "amount must be a decimal string"),
  ...OptionalIdempotencyFields,
});

/** erc8183.fund_job — fund a job */
export const Erc8183FundJobInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string"),
  optParams: z.string().optional(),
});

/** erc8183.complete_job — complete a job (evaluator) */
export const Erc8183CompleteJobInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string"),
  reason: z.string().min(1, "reason is required"),
  optParams: z.string().optional(),
});

/** erc8183.reject_job — reject a job (evaluator) */
export const Erc8183RejectJobInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string"),
  reason: z.string().min(1, "reason is required"),
  optParams: z.string().optional(),
});

/** erc8183.claim_refund — claim refund for expired job */
export const Erc8183ClaimRefundInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string"),
});

/** erc8183.set_provider — assign provider to open job */
export const Erc8183SetProviderInputSchema = z.object({
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string"),
  provider: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "provider must be a valid address"),
});

/** circle.gateway_deposit — deposit USDC into Circle Gateway */
export const CircleGatewayDepositInputSchema = z.object({
  amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/, "amount must be a decimal string"),
  method: z.enum(["eco", "direct"]).optional(),
});

// ── ERC-8004 Chat-Approved Registration ─────────────────────────────────

/** erc8004.register_approval_create — create pending registration approval */
export const Erc8004RegisterApprovalCreateInputSchema = z.object({
  controllerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "controllerAddress must be a valid EVM address"),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "ownerAddress must be a valid EVM address"),
  agentName: z.string().min(1, "agentName is required").max(128),
  role: z.enum(["provider", "evaluator"], { errorMap: () => ({ message: "role must be provider or evaluator" }) }),
  metadataURI: z.string().min(1, "metadataURI is required").refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return ["http:", "https:", "ipfs:", "arclayer:"].includes(parsed.protocol);
      } catch {
        return false;
      }
    },
    "metadataURI must be a valid http(s)://, ipfs://, or arclayer:// URI"
  ),
  metadataJson: z.record(z.unknown()).optional(),
  chainId: z.number().int().positive().optional(),
  registryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  expiresInSeconds: z.number().int().min(60).max(86400).optional(),
  idempotencyKey: z.string().min(1).optional(),
});

/** erc8004.register_approval_get — get registration approval by id */
export const Erc8004RegisterApprovalGetInputSchema = z.object({
  approvalId: z.string().min(1),
});

/** erc8004.register_approval_approve — approve pending registration approval */
export const Erc8004RegisterApprovalApproveInputSchema = z.object({
  approvalId: z.string().min(1),
});

/** erc8004.register_approval_reject — reject pending registration approval */
export const Erc8004RegisterApprovalRejectInputSchema = z.object({
  approvalId: z.string().min(1),
  reason: z.string().optional(),
});

/** erc8004.register_approval_execute — execute approved registration */
export const Erc8004RegisterApprovalExecuteInputSchema = z.object({
  approvalId: z.string().min(1),
});

/** erc8004.register_approval_approve_and_execute — convenience: approve + execute */
export const Erc8004RegisterApprovalApproveAndExecuteInputSchema = z.object({
  approvalId: z.string().min(1),
});

// ── Approvals ───────────────────────────────────────────────────────────

/** approvals.create — create a pending approval for a client action */
export const ApprovalsCreateInputSchema = z.object({
  actionType: z.enum(["createJob", "approveUsdc", "fundJob", "claimRefund"]),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "walletAddress must be a valid address"),
  chainId: z.number().int().positive(),
  jobId: z.string().regex(/^[0-9]+$/, "jobId must be a numeric string").optional(),
  amount: z.string().optional(),
  params: z.record(z.unknown()),
  expiresInSeconds: z.number().int().min(60).max(86400).optional(),
  idempotencyKey: z.string().min(1).optional(),
});

/** approvals.get — get an approval by id */
export const ApprovalsGetInputSchema = z.object({
  approvalId: z.string().min(1),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "walletAddress must be a valid address"),
  role: z.string().min(1),
});

/** approvals.approve — approve a pending approval */
export const ApprovalsApproveInputSchema = z.object({
  approvalId: z.string().min(1),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "walletAddress must be a valid address"),
  role: z.string().min(1),
  chainId: z.number().int().positive(),
  expectedRequestHash: z.string().optional(),
});

/** approvals.reject — reject a pending approval */
export const ApprovalsRejectInputSchema = z.object({
  approvalId: z.string().min(1),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "walletAddress must be a valid address"),
  role: z.string().min(1),
  reason: z.string().optional(),
});

/** approvals.cancel — cancel a pending approval */
export const ApprovalsCancelInputSchema = z.object({
  approvalId: z.string().min(1),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "walletAddress must be a valid address"),
  role: z.string().min(1),
});

/** approvals.list_pending — list pending approvals */
export const ApprovalsListPendingInputSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "walletAddress must be a valid address"),
  limit: z.number().int().min(1).max(100).optional(),
});

// ── Schema Registry ──────────────────────────────────────────────────────

/**
 * Map from MCP tool name → Zod schema for input validation.
 * Only tools with non-trivial input validation are listed.
 * Read-only tools (runner.health, circle.status, etc.) are omitted —
 * they either accept no args or only an optional `limit: number`.
 */
export const MCP_TOOL_INPUT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "x402.inspect": X402InspectInputSchema,
  "x402.pay": X402PayInputSchema,
  "x402.batch_pay": X402BatchPayInputSchema,
  "erc8004.prepare_register": Erc8004PrepareRegisterInputSchema,
  "erc8004.register_execute": Erc8004RegisterExecuteInputSchema,
  "erc8183.provider_run_job": Erc8183ProviderRunJobInputSchema,
  "erc8183.provider_submit_deliverable": Erc8183ProviderSubmitDeliverableInputSchema,
  "erc8183.provider_run_and_submit": Erc8183ProviderRunAndSubmitInputSchema,
  "erc8183.create_job": Erc8183CreateJobInputSchema,
  "erc8183.set_budget": Erc8183SetBudgetInputSchema,
  "erc8183.approve_usdc": Erc8183ApproveUsdcInputSchema,
  "erc8183.fund_job": Erc8183FundJobInputSchema,
  "erc8183.complete_job": Erc8183CompleteJobInputSchema,
  "erc8183.reject_job": Erc8183RejectJobInputSchema,
  "erc8183.claim_refund": Erc8183ClaimRefundInputSchema,
  "erc8183.set_provider": Erc8183SetProviderInputSchema,
  "circle.gateway_deposit": CircleGatewayDepositInputSchema,
  "erc8004.register_approval_create": Erc8004RegisterApprovalCreateInputSchema,
  "erc8004.register_approval_get": Erc8004RegisterApprovalGetInputSchema,
  "erc8004.register_approval_approve": Erc8004RegisterApprovalApproveInputSchema,
  "erc8004.register_approval_reject": Erc8004RegisterApprovalRejectInputSchema,
  "erc8004.register_approval_execute": Erc8004RegisterApprovalExecuteInputSchema,
  "erc8004.register_approval_approve_and_execute": Erc8004RegisterApprovalApproveAndExecuteInputSchema,
  "approvals.create": ApprovalsCreateInputSchema,
  "approvals.get": ApprovalsGetInputSchema,
  "approvals.approve": ApprovalsApproveInputSchema,
  "approvals.reject": ApprovalsRejectInputSchema,
  "approvals.cancel": ApprovalsCancelInputSchema,
  "approvals.list_pending": ApprovalsListPendingInputSchema,
};

/**
 * Get the Zod input schema for a tool, or undefined if the tool has no schema.
 */
export function getMcpToolInputSchema(toolName: string): z.ZodTypeAny | undefined {
  return MCP_TOOL_INPUT_SCHEMAS[toolName];
}

/**
 * Validate and parse MCP tool args against the tool's Zod schema.
 * Returns the parsed (typed) data on success.
 * Throws ZodError on validation failure.
 *
 * If the tool has no registered schema, returns the raw args unchanged.
 */
export function validateMcpToolInput<T = Record<string, unknown>>(
  toolName: string,
  args: Record<string, unknown>
): T {
  const schema = MCP_TOOL_INPUT_SCHEMAS[toolName];
  if (!schema) return args as T;
  return schema.parse(args) as T;
}

/**
 * Safely validate MCP tool args. Returns a result object instead of throwing.
 * Use this in the broker where throwing is the error path.
 */
export function safeValidateMcpToolInput(
  toolName: string,
  args: Record<string, unknown>
): { ok: true; data: unknown } | { ok: false; error: string; issues: string[] } {
  const schema = MCP_TOOL_INPUT_SCHEMAS[toolName];
  if (!schema) return { ok: true, data: args };

  const result = schema.safeParse(args);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    issues: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

// ── Zod → JSON Schema Converter ──────────────────────────────────────────

/**
 * Minimal Zod → JSON Schema converter for MCP tools/list inputSchema.
 *
 * Handles the subset of Zod types used in MCP tool input schemas:
 * - z.string(), z.number(), z.boolean()
 * - z.string().url(), z.string().regex(), z.string().min()
 * - z.enum([...])
 * - z.object({...})
 * - z.array(z.object({...}))
 * - z.optional() / z.default()
 * - z.union([z.string(), z.number()])
 * - z.unknown()
 * - z.literal()
 *
 * Produces a flat JSON Schema object compatible with MCP tools/list format
 * and the existing validateToolArgs() in mcp-broker.ts.
 */
export function zodInputSchemaToJsonSchema(
  zodSchema: z.ZodTypeAny
): Record<string, unknown> | undefined {
  return zodShapeToJsonSchema(zodSchema);
}

function zodShapeToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> | undefined {
  // Unwrap optional/default wrappers
  const unwrapped = unwrapZodSchema(schema);
  const shape = getZodShape(unwrapped);
  if (!shape) return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const field = fieldSchema as z.ZodTypeAny;
    const spec = zodFieldToSpec(field);
    if (spec) {
      // Mark non-optional fields as required for MCP tools/list consumers
      if (!isOptional(field)) {
        spec.required = true;
      }
      result[key] = spec;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function unwrapZodSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  // ZodOptional
  if (schema._def?.typeName === "ZodOptional") {
    return unwrapZodSchema(schema._def.innerType);
  }
  // ZodDefault
  if (schema._def?.typeName === "ZodDefault") {
    return unwrapZodSchema(schema._def.innerType);
  }
  // ZodEffects (refine, transform, preprocess)
  if (schema._def?.typeName === "ZodEffects") {
    return unwrapZodSchema(schema._def.schema);
  }
  return schema;
}

function isOptional(schema: z.ZodTypeAny): boolean {
  if (schema._def?.typeName === "ZodOptional") return true;
  if (schema._def?.typeName === "ZodDefault") return true;
  if (schema._def?.typeName === "ZodEffects") {
    return isOptional(schema._def.schema);
  }
  return false;
}

function getZodShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> | undefined {
  if (schema._def?.typeName === "ZodObject") {
    return schema._def.shape();
  }
  return undefined;
}

function zodFieldToSpec(schema: z.ZodTypeAny): Record<string, unknown> | undefined {
  const typeName = schema._def?.typeName;

  // Optional wrapper — recurse but mark as not required
  if (typeName === "ZodOptional") {
    const inner = zodFieldToSpec(schema._def.innerType);
    if (inner) {
      delete inner.required;
    }
    return inner;
  }

  // Default wrapper — recurse but mark as not required
  if (typeName === "ZodDefault") {
    const inner = zodFieldToSpec(schema._def.innerType);
    if (inner) {
      delete inner.required;
    }
    return inner;
  }

  // Effects (refine, transform, preprocess) — recurse into inner schema
  if (typeName === "ZodEffects") {
    return zodFieldToSpec(schema._def.schema);
  }

  // String
  if (typeName === "ZodString") {
    const spec: Record<string, unknown> = { type: "string" };
    // Check for .url() validation
    const checks = schema._def?.checks ?? [];
    for (const check of checks) {
      if (check.kind === "url") {
        spec.format = "url";
      }
    }
    return spec;
  }

  // Number
  if (typeName === "ZodNumber") {
    return { type: "number" };
  }

  // Boolean
  if (typeName === "ZodBoolean") {
    return { type: "boolean" };
  }

  // Enum
  if (typeName === "ZodEnum") {
    const values = schema._def.values as string[];
    return { type: "string", enum: values };
  }

  // Literal
  if (typeName === "ZodLiteral") {
    const value = schema._def.value;
    return { type: typeof value, const: value };
  }

  // Array
  if (typeName === "ZodArray") {
    const innerType = schema._def.type;
    const innerShape = getZodShape(unwrapZodSchema(innerType));
    if (innerShape) {
      const properties: Record<string, unknown> = {};
      for (const [key, fieldSchema] of Object.entries(innerShape)) {
        const spec = zodFieldToSpec(fieldSchema as z.ZodTypeAny);
        if (spec) properties[key] = spec;
      }
      return {
        type: "array",
        items: { type: "object", properties },
        minItems: (schema._def as any).minLength?.value,
      };
    }
    return { type: "array" };
  }

  // Object (nested)
  if (typeName === "ZodObject") {
    const shape = schema._def.shape();
    const properties: Record<string, unknown> = {};
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const spec = zodFieldToSpec(fieldSchema as z.ZodTypeAny);
      if (spec) properties[key] = spec;
    }
    return { type: "object", properties };
  }

  // Union (z.union, z.coerce.string() which is union of string + transform)
  if (typeName === "ZodUnion") {
    const options = schema._def.options as z.ZodTypeAny[];
    // For MCP, treat union as the first option's type
    if (options.length > 0) {
      return zodFieldToSpec(options[0]);
    }
    return { type: "string" };
  }

  // Unknown / Any
  if (typeName === "ZodUnknown" || typeName === "ZodAny") {
    return { type: "object" };
  }
  // Record (z.record(...)) — emit as object with additionalProperties
  if (typeName === "ZodRecord") {
    return { type: "object", additionalProperties: {} };
  }

  // Fallback
  return { type: "string" };
}
