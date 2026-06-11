import { z } from "zod";

// ── Runtime & Role ─────────────────────────────────────────────────────────

export const RuntimeKindSchema = z.enum(["hermes", "openclaw", "custom"]);
export type RuntimeKind = z.infer<typeof RuntimeKindSchema>;

export const RunnerRoleSchema = z.enum(["provider", "client", "evaluator"]);
export type RunnerRole = z.infer<typeof RunnerRoleSchema>;

// ── Address helpers ─────────────────────────────────────────────────────────

export const HexAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const HexBytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

// ── Policy Config (standalone file: ~/.arclayer/runner/policy.json) ──────────

export const PolicyConfigSchema = z.object({
  paymentEnabled: z.preprocess(
    (v) => {
      if (typeof v === "string") return v === "true" || v === "1";
      return v;
    },
    z.boolean().default(false)
  ),
  perTxLimitUsdc: z.string().default("0.01"),
  dailyLimitUsdc: z.string().default("1"),
  monthlyLimitUsdc: z.string().default("20"),
  batchMaxItems: z.coerce.number().int().min(1).max(100).default(10),
  batchMaxTotalUsdc: z.string().default("0.05"),
  allowedX402Hosts: z.array(z.string()).default([])
});

export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

// ── Runner Config ───────────────────────────────────────────────────────────

export const RunnerConfigSchema = z.object({
  runnerId: z.string().min(1),
  agentId: z.string().min(1),
  agentAddress: HexAddressSchema,
  runtimeKind: RuntimeKindSchema,
  runtimeEndpoint: z.string().url(),
  runtimeRunPath: z.string().default("/run"),
  defaultRole: RunnerRoleSchema.default("provider"),
  allowedRoles: z.array(RunnerRoleSchema).default(["provider"]),
  skillPath: z.string().optional(),
  skillHash: z.string().optional(),

  chain: z.string().default("ARC-TESTNET"),
  circleCliBin: z.string().default("circle"),
  circleWalletAddress: HexAddressSchema.optional(),

  paymentEnabled: z.preprocess(
    (v) => {
      if (typeof v === "string") return v === "true" || v === "1";
      return v;
    },
    z.boolean().default(false)
  ),
  perTxLimitUsdc: z.string().default("0.01"),
  dailyLimitUsdc: z.string().default("1"),
  monthlyLimitUsdc: z.string().default("20"),
  batchMaxItems: z.coerce.number().int().min(1).max(100).default(10),
  batchMaxTotalUsdc: z.string().default("0.05"),
  allowedX402Hosts: z.array(z.string()).default([]),

  erc8183ContractAddress: HexAddressSchema.optional(),
  erc8004IdentityRegistryAddress: HexAddressSchema.optional(),

  dataDir: z.string().default(".arclayer-runner"),
  port: z.coerce.number().int().min(1).max(65535).default(8787),
  runnerSecret: z.string().min(16)
});

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;

// ── Agent Task (input to runtime) ───────────────────────────────────────────

export const AgentTaskSchema = z.object({
  taskId: z.string().min(1),
  protocol: z.enum(["erc8004", "erc8183", "x402", "generic"]),
  role: RunnerRoleSchema.default("provider"),
  agentId: z.string().min(1),
  input: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export type AgentTask = z.infer<typeof AgentTaskSchema>;

// ── Runtime Result (output from runtime) ────────────────────────────────────

export const RuntimeResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum(["completed", "failed", "needs_payment", "needs_action"]).default("completed"),
  output: z.unknown().optional(),
  artifacts: z.array(z.object({
    name: z.string(),
    uri: z.string().optional(),
    contentType: z.string().optional(),
    sha256: z.string().optional()
  })).default([]),
  paymentRequests: z.array(z.object({
    type: z.literal("x402_service_pay"),
    url: z.string().url(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    body: z.unknown().optional(),
    maxAmountUsdc: z.string(),
    reason: z.string().min(1),
    idempotencyKey: z.string().optional()
  })).default([]),
  actionRequests: z.array(z.object({
    type: z.string(),
    payload: z.unknown()
  })).default([]),
  error: z.string().optional()
});

export type RuntimeResult = z.infer<typeof RuntimeResultSchema>;

// ── ERC-8183 Provider Job ───────────────────────────────────────────────────

export const Erc8183ProviderJobSchema = z.object({
  taskId: z.string().min(1),
  jobId: z.string().regex(/^[0-9]+$/),
  agentId: z.string().min(1),
  provider: HexAddressSchema,
  evaluator: HexAddressSchema.optional(),
  description: z.string().min(1),
  input: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export type Erc8183ProviderJob = z.infer<typeof Erc8183ProviderJobSchema>;

// ── Payment Request ─────────────────────────────────────────────────────────

export const PaymentRequestSchema = z.object({
  type: z.literal("x402_service_pay"),
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  body: z.unknown().optional(),
  maxAmountUsdc: z.string().regex(/^[0-9]+(\.[0-9]+)?$/),
  reason: z.string().min(1),
  idempotencyKey: z.string().optional()
});

export type PaymentRequest = z.infer<typeof PaymentRequestSchema>;

// ── Batch Payment Request ───────────────────────────────────────────────────

export const BatchPaymentRequestSchema = z.object({
  batchId: z.string().min(1),
  taskId: z.string().min(1),
  payments: z.array(PaymentRequestSchema).min(1)
});

export type BatchPaymentRequest = z.infer<typeof BatchPaymentRequestSchema>;

// ── Receipt Record ──────────────────────────────────────────────────────────

export type ReceiptRecord = {
  id: string;
  createdAt: string;
  type: "x402_payment" | "erc8183_submit" | "erc8004_prepare_register" | "runtime_result" | "policy_reject" | "circle_status";
  taskId?: string;
  jobId?: string;
  agentId?: string;
  request?: unknown;
  response?: unknown;
  error?: string;
  idempotencyKey?: string;
  proof?: {
    sha256?: string;
    txHash?: string;
    deliverableHash?: string;
    circleCommand?: string;
  };
};

// ── Spending Ledger Record ──────────────────────────────────────────────────

export type LedgerRecord = {
  id: string;
  createdAt: string;
  idempotencyKey: string;
  status: "attempt" | "success" | "failure";
  amountUsdc: string;
  amountMicros: string;
  dayBucket: string;   // YYYY-MM-DD
  monthBucket: string;  // YYYY-MM
  url?: string;
  reason?: string;
  receiptId?: string;
  error?: string;
};
