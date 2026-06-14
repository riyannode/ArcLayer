/**
 * Autonomy schemas for autonomous ERC-8183 lifecycle workers.
 *
 * Shared across client orchestrator, provider worker, evaluator worker,
 * and x402 coordinator. Lives in runner-core so both Runner and Console
 * can import without circular dependencies.
 */
import { z } from "zod";

// ── Autonomy Config ────────────────────────────────────────────────────

export const AutonomyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  pollIntervalMs: z.number().int().min(1000).default(5000),
  leaseMs: z.number().int().min(2000).default(60000),
  maxRetries: z.number().int().min(0).max(10).default(3),
  maxConcurrentJobs: z.number().int().min(1).max(10).default(1),
  x402ResumeEnabled: z.boolean().default(false),
  maxX402CyclesPerJob: z.number().int().min(0).max(10).default(3),
  maxX402SpendPerJobUsdc: z.string().regex(/^\d+(\.\d+)?$/).default("0.05"),
  evaluatorCompleteThreshold: z.number().int().min(0).max(100).default(80),
  evaluatorManualReviewThreshold: z.number().int().min(0).max(100).default(60),
  allowLegacyPlainTextJobs: z.boolean().default(false),
}).refine(
  (data) => data.leaseMs > data.pollIntervalMs,
  { message: "leaseMs must exceed pollIntervalMs" }
).refine(
  (data) => data.evaluatorManualReviewThreshold < data.evaluatorCompleteThreshold,
  { message: "evaluatorManualReviewThreshold must be lower than evaluatorCompleteThreshold" }
);

export type AutonomyConfig = z.infer<typeof AutonomyConfigSchema>;

// ── Network Config ─────────────────────────────────────────────────────

export const NetworkConfigSchema = z.object({
  rpcUrl: z.string().url().refine(
    (url) => url.startsWith("https://") || url.includes("localhost") || url.includes("127.0.0.1"),
    { message: "RPC URL must be HTTPS unless localhost" }
  ),
});

export type NetworkConfig = z.infer<typeof NetworkConfigSchema>;

// ── Circle Config (for autonomy workers) ───────────────────────────────

export const CircleConfigSchema = z.object({
  cliBin: z.string().default("circle"),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chain: z.string().default("ARC-TESTNET"),
});

export type CircleConfig = z.infer<typeof CircleConfigSchema>;

// ── Runtime Config ─────────────────────────────────────────────────────

export const RuntimeConfigSchema = z.object({
  target: z.enum(["hermes", "openclaw", "custom"]).default("hermes"),
  timeoutMs: z.number().int().min(5000).max(600000).default(120000),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

// ── Nested Runner Config (autonomy section) ────────────────────────────

export const RunnerAutonomyConfigSchema = z.object({
  agentId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  role: z.enum(["client", "provider", "evaluator", "x402-agent"]),
  circle: CircleConfigSchema,
  runtime: RuntimeConfigSchema.optional(),
  autonomy: AutonomyConfigSchema,
  network: NetworkConfigSchema,
});

export type RunnerAutonomyConfig = z.infer<typeof RunnerAutonomyConfigSchema>;

// ── Job Envelope (versioned JSON in contract description field) ─────────

export const AutonomousJobEnvelopeSchema = z.object({
  version: z.literal(1),
  type: z.literal("arclayer.autonomous-job"),
  task: z.string().min(1).max(8000),
  input: z.unknown().optional(),
  acceptanceCriteria: z.array(z.string().min(1)).min(1).max(20),
  outputFormat: z.enum(["text", "json", "markdown"]).default("text"),
  x402: z.object({
    allowed: z.boolean().default(false),
    maxSpendUsdc: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
    allowedHosts: z.array(z.string()).default([]),
  }).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type AutonomousJobEnvelope = z.infer<typeof AutonomousJobEnvelopeSchema>;

/**
 * Encode a job envelope into a JSON string for the contract description field.
 */
export function encodeJobEnvelope(envelope: AutonomousJobEnvelope, maxSize = 16000): string {
  const encoded = JSON.stringify(envelope);
  if (encoded.length > maxSize) {
    throw new Error(`Encoded job envelope (${encoded.length} bytes) exceeds max size (${maxSize} bytes)`);
  }
  return encoded;
}

/**
 * Decode and validate a job envelope from a contract description string.
 * Returns null if the string is not a valid autonomous job envelope.
 */
export function decodeJobEnvelope(description: string): AutonomousJobEnvelope | null {
  try {
    const parsed = JSON.parse(description);
    const result = AutonomousJobEnvelopeSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Check if a description string is a valid autonomous job envelope.
 */
export function isAutonomousJobEnvelope(description: string): boolean {
  return decodeJobEnvelope(description) !== null;
}

// ── Evaluation Verdict ─────────────────────────────────────────────────

export const EvaluationVerdictSchema = z.object({
  decision: z.enum(["complete", "reject", "manual_review"]),
  score: z.number().min(0).max(100),
  reason: z.string().min(1).max(4000),
  evidence: z.array(z.object({
    criterion: z.string().min(1),
    passed: z.boolean(),
    detail: z.string().min(1),
  })).min(1),
  evaluatedDeliverableHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export type EvaluationVerdict = z.infer<typeof EvaluationVerdictSchema>;

// ── Operation Expectation (for reconciliation) ─────────────────────────

export const OperationExpectationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("job_status"),
    jobId: z.string(),
    expectedStatus: z.number().int().min(0).max(5),
  }),
  z.object({
    kind: z.literal("job_budget"),
    jobId: z.string(),
    expectedBudget: z.string(),
  }),
  z.object({
    kind: z.literal("job_provider"),
    jobId: z.string(),
    expectedProvider: z.string(),
  }),
  z.object({
    kind: z.literal("usdc_allowance"),
    owner: z.string(),
    spender: z.string(),
    minimumAmount: z.string(),
  }),
  z.object({
    kind: z.literal("job_created"),
    client: z.string(),
    provider: z.string(),
    evaluator: z.string(),
    descriptionHash: z.string(),
  }),
  z.object({
    kind: z.literal("submitted_deliverable"),
    jobId: z.string(),
    deliverableHash: z.string(),
  }),
]);

export type OperationExpectation = z.infer<typeof OperationExpectationSchema>;

// ── Onchain Job (normalized from contract read) ────────────────────────

export type OnchainJob = {
  id: bigint;
  client: `0x${string}`;
  provider: `0x${string}`;
  evaluator: `0x${string}`;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: `0x${string}`;
};

/**
 * ERC-8183 job status enum.
 * Matches contract: 0=Open, 1=Funded, 2=Submitted, 3=Completed, 4=Rejected, 5=Expired
 */
export const JOB_STATUS = {
  Open: 0,
  Funded: 1,
  Submitted: 2,
  Completed: 3,
  Rejected: 4,
  Expired: 5,
} as const;

export type JobStatusLabel = keyof typeof JOB_STATUS;

export function jobStatusLabel(status: number): JobStatusLabel {
  const entry = Object.entries(JOB_STATUS).find(([, v]) => v === status);
  return (entry?.[0] as JobStatusLabel) ?? "Open";
}

// ── USDC Decimal Helpers ───────────────────────────────────────────────

// decimalToMicros is already exported from ./policy via index.ts.
// Do not re-export here to avoid ambiguity.

/**
 * Convert atomic USDC units (6 decimals) to human-readable string.
 */
export function microsToDecimal(micros: bigint): string {
  const whole = micros / 1000000n;
  const frac = micros % 1000000n;
  return `${whole}.${frac.toString().padStart(6, "0")}`.replace(/\.?0+$/, "") || "0";
}
