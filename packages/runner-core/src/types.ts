import { z } from "zod";

// ── Runtime & Role ─────────────────────────────────────────────────────────

export const RuntimeKindSchema = z.enum(["hermes", "openclaw", "custom"]);
export type RuntimeKind = z.infer<typeof RuntimeKindSchema>;

export const RunnerRoleSchema = z.enum([
  "provider",
  "client",
  "evaluator",
  "x402-agent",
  "identity-agent",
  "validation-agent",
  "devops-admin",
  "full-stack-agent",
]);
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

// ── Wallet address validation ───────────────────────────────────────────────

/**
 * Validate a wallet address. Rejects private keys and invalid formats.
 * Only accepts 0x-prefixed 40-hex-char Ethereum addresses.
 */
export function validateWalletAddress(input: string): { valid: boolean; error?: string } {
  if (!input || typeof input !== "string") {
    return { valid: false, error: "Wallet address is required" };
  }
  const trimmed = input.trim();

  // Reject private keys (64 hex chars without 0x, or 66 with 0x)
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return { valid: false, error: "This looks like a private key, not a wallet address. Never enter private keys here." };
  }
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) {
    return { valid: false, error: "This looks like a private key (66 chars), not a wallet address. Never enter private keys here." };
  }

  // Valid address: 0x + 40 hex chars
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return { valid: false, error: "Invalid wallet address. Expected 0x followed by 40 hex characters." };
  }

  return { valid: true };
}

// ── Init/Setup file config (nested shape for config.json) ───────────────────

export const InitFileConfigSchema = z.object({
  agentId: z.string().min(1),
  role: RunnerRoleSchema.default("provider"),
  runnerId: z.string().optional(),
  agentAddress: z.string().optional(),
  circle: z.object({
    cliBin: z.string().default("circle"),
    walletAddress: z.string().optional(),
    chain: z.string().default("BASE")
  }).default({}),
  runtime: z.object({
    target: RuntimeKindSchema.default("openclaw")
  }).default({}),
  mcp: z.object({
    mode: z.enum(["stdio", "http"]).default("stdio")
  }).default({})
});

export type InitFileConfig = z.infer<typeof InitFileConfigSchema>;

/**
 * Transform nested file config + policy config → flat RunnerConfig shape.
 * This produces a partial RunnerConfig (no runnerSecret, no agentAddress, etc.)
 * that gets merged with env vars and validated by RunnerConfigSchema.
 */
export function transformFileConfig(
  file: InitFileConfig,
  policy: PolicyConfig
): Record<string, unknown> {
  return {
    agentId: file.agentId,
    defaultRole: file.role,
    allowedRoles: [file.role],
    runnerId: file.runnerId ?? `runner-${file.agentId}`,
    agentAddress: file.agentAddress ?? "0x0000000000000000000000000000000000000000",
    circleCliBin: file.circle?.cliBin ?? "circle",
    circleWalletAddress: file.circle?.walletAddress || undefined,
    chain: file.circle?.chain ?? "BASE",
    runtimeKind: file.runtime?.target ?? "openclaw",
    runtimeEndpoint: "http://127.0.0.1:8787", // default, overridable via env
    runtimeRunPath: "/run",
    // Policy fields from policy.json
    ...policy
  };
}

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

  // @deprecated — Arc contract addresses come from SDK constants (CONTRACTS.*).
  // These fields exist only for backward compatibility with old config files.
  // They are NOT generated by init/setup, NOT shown in setup wizard, NOT documented,
  // and NOT used to override the contract target. Doctor warns if set manually.
  erc8183ContractAddress: HexAddressSchema.optional(),
  erc8004IdentityRegistryAddress: HexAddressSchema.optional(),

  // ── Explicit opt-in flags for privileged operations ─────────────────────
  allowGatewayDeposit: z.preprocess(
    (v) => {
      if (typeof v === "string") return v === "true" || v === "1";
      return v;
    },
    z.boolean().default(false)
  ),
  allowIdentityRegister: z.preprocess(
    (v) => {
      if (typeof v === "string") return v === "true" || v === "1";
      return v;
    },
    z.boolean().default(false)
  ),

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
