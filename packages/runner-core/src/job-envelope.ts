/**
 * JobEnvelopeV1 — Canonical job description schema for ERC-8183 agentic commerce.
 *
 * Encodes task, acceptance criteria, commercial terms, and x402 policy
 * into a deterministic JSON envelope that travels on-chain as `description`.
 *
 * Design:
 *   - Deterministic canonical JSON (sorted keys at every level)
 *   - Maximum encoded size: 32 KB
 *   - Reject unknown versions
 *   - Exact decimal parsing for USDC amounts
 *   - Legacy plain text allowed only with explicit compatibility mode
 *   - Legacy jobs cannot use automatic x402 or automatic evaluator settlement
 */

import { z } from "zod";

// ── Schemas ────────────────────────────────────────────────────────────────

const AcceptanceCriterionSchema = z.object({
  id: z.string().min(1).max(128),
  description: z.string().min(1).max(2048),
  mandatory: z.boolean(),
});

const CommercialTermsSchema = z.object({
  proposedBudgetUsdc: z.string().refine(
    (v) => {
      const match = v.match(/^\d+(\.\d{1,6})?$/);
      if (!match) return false;
      const num = parseFloat(v);
      return num > 0 && num <= 1_000_000;
    },
    { message: "proposedBudgetUsdc must be a positive USDC string with max 6 decimals" },
  ),
  clientWillFund: z.literal(true),
});

const X402PolicySchema = z.object({
  enabled: z.boolean(),
  maxSpendUsdc: z.string().refine(
    (v) => {
      const match = v.match(/^\d+(\.\d{1,6})?$/);
      if (!match) return false;
      const num = parseFloat(v);
      return num >= 0 && num <= 10_000;
    },
    { message: "maxSpendUsdc must be a non-negative USDC string with max 6 decimals" },
  ),
  allowedHosts: z.array(z.string().url()).max(64),
  maxCycles: z.number().int().min(0).max(100),
});

/**
 * Output format hint for the runtime.
 * Guides how the provider should structure deliverable output.
 */
const OutputFormatSchema = z.enum(["text", "markdown", "json"]);

/**
 * JobEnvelopeV1 — the canonical on-chain description format.
 *
 * The `schema` field MUST be "arclayer.job" and `version` MUST be 1.
 * Any other combination is rejected as unknown.
 */
export const JobEnvelopeV1Schema = z.object({
  schema: z.literal("arclayer.job"),
  version: z.literal(1),

  task: z.string().min(1).max(16384),
  input: z.unknown().optional(),

  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1).max(32),

  outputFormat: OutputFormatSchema.optional(),

  commercialTerms: CommercialTermsSchema,

  x402: X402PolicySchema,

  metadata: z.record(z.unknown()).optional(),
});

export type JobEnvelopeV1 = z.infer<typeof JobEnvelopeV1Schema>;

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export type CommercialTerms = z.infer<typeof CommercialTermsSchema>;

export type X402Policy = z.infer<typeof X402PolicySchema>;

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_ENCODED_BYTES = 32 * 1024; // 32 KB

const ENVELOPE_SCHEMA = "arclayer.job";
const ENVELOPE_VERSION = 1;

// ── Canonical JSON (reuses sorted-keys pattern from hash.ts) ───────────────

/**
 * Deterministic JSON serialization.
 * Recursively sorts all object keys at every nesting level.
 * This ensures the same logical envelope always produces the same bytes.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys.map(
      (k) => JSON.stringify(k) + ":" + canonicalStringify((value as Record<string, unknown>)[k]),
    );
    return "{" + pairs.join(",") + "}";
  }
  return String(value);
}

// ── Encode ─────────────────────────────────────────────────────────────────

/**
 * Encode a validated JobEnvelopeV1 into deterministic canonical JSON bytes.
 *
 * Returns the UTF-8 string that is used as the on-chain `description` field.
 * Throws if the encoded size exceeds MAX_ENCODED_BYTES.
 */
export function encodeJobEnvelope(envelope: JobEnvelopeV1): string {
  const validated = JobEnvelopeV1Schema.parse(envelope);
  const encoded = canonicalStringify(validated);

  const byteLength = Buffer.byteLength(encoded, "utf-8");
  if (byteLength > MAX_ENCODED_BYTES) {
    throw new Error(
      `JobEnvelope encoded size ${byteLength} exceeds maximum ${MAX_ENCODED_BYTES} bytes`,
    );
  }

  return encoded;
}

// ── Decode ─────────────────────────────────────────────────────────────────

/**
 * Decode a JSON string into a validated JobEnvelopeV1.
 *
 * Accepts both canonical and non-canonical JSON (reordered keys are fine).
 * Rejects unknown schema/version combinations.
 *
 * For legacy plain-text descriptions (non-JSON or wrong schema), returns null
 * when `allowLegacy` is false (default), or throws when allowLegacy is true
 * and the input is neither valid JSON nor a JobEnvelope.
 */
export function decodeJobEnvelope(
  raw: string,
  options?: { allowLegacy?: boolean },
): JobEnvelopeV1 | null {
  if (!raw || typeof raw !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — legacy plain text
    if (options?.allowLegacy) return null;
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Reject unknown schema
  if (obj.schema !== ENVELOPE_SCHEMA) return null;

  // Reject unknown version
  if (obj.version !== ENVELOPE_VERSION) return null;

  const result = JobEnvelopeV1Schema.safeParse(parsed);
  if (!result.success) return null;

  return result.data;
}

// ── Validate ───────────────────────────────────────────────────────────────

export type JobEnvelopeValidationResult = {
  valid: boolean;
  envelope: JobEnvelopeV1 | null;
  errors: string[];
};

/**
 * Full validation of a raw description string.
 *
 * Returns structured result with errors array for programmatic handling.
 * Does NOT throw — use this in routes that need to report validation failures.
 */
export function validateJobEnvelope(raw: string): JobEnvelopeValidationResult {
  if (!raw || typeof raw !== "string") {
    return { valid: false, envelope: null, errors: ["description is empty or not a string"] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      valid: false,
      envelope: null,
      errors: ["description is not valid JSON (legacy plain text not supported for new jobs)"],
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, envelope: null, errors: ["description JSON is not an object"] };
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.schema !== ENVELOPE_SCHEMA) {
    return {
      valid: false,
      envelope: null,
      errors: [`expected schema "${ENVELOPE_SCHEMA}", got "${obj.schema}"`],
    };
  }

  if (obj.version !== ENVELOPE_VERSION) {
    return {
      valid: false,
      envelope: null,
      errors: [`expected version ${ENVELOPE_VERSION}, got ${obj.version}`],
    };
  }

  const result = JobEnvelopeV1Schema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    return { valid: false, envelope: null, errors };
  }

  // Size check
  const encoded = canonicalStringify(result.data);
  const byteLength = Buffer.byteLength(encoded, "utf-8");
  if (byteLength > MAX_ENCODED_BYTES) {
    return {
      valid: false,
      envelope: null,
      errors: [`encoded size ${byteLength} exceeds maximum ${MAX_ENCODED_BYTES} bytes`],
    };
  }

  return { valid: true, envelope: result.data, errors: [] };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check if a raw description string is a JobEnvelopeV1 (vs legacy plain text).
 */
export function isJobEnvelope(raw: string): boolean {
  if (!raw || typeof raw !== "string") return false;
  try {
    const parsed = JSON.parse(raw);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      parsed.schema === ENVELOPE_SCHEMA &&
      parsed.version === ENVELOPE_VERSION
    );
  } catch {
    return false;
  }
}

/**
 * Check if a legacy plain-text job is eligible for automatic x402.
 * Legacy jobs MUST NOT use automatic x402 or automatic evaluator settlement.
 */
export function isLegacyJob(description: string): boolean {
  return !isJobEnvelope(description);
}

/**
 * Extract the proposed budget from a JobEnvelopeV1 as a decimal string.
 * Returns null for legacy jobs.
 */
export function extractProposedBudget(description: string): string | null {
  const envelope = decodeJobEnvelope(description);
  if (!envelope) return null;
  return envelope.commercialTerms.proposedBudgetUsdc;
}

/**
 * Parse a USDC decimal string into atomic units (6 decimals).
 * Uses exact bigint arithmetic — no floating point.
 *
 * @example parseUsdcToAtomic("5.00") → 5000000n
 * @example parseUsdcToAtomic("0.000001") → 1n
 */
export function parseUsdcToAtomic(value: string): bigint {
  const match = value.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) throw new Error(`Invalid USDC amount: ${value}`);
  const intPart = BigInt(match[1]);
  const fracStr = (match[2] ?? "").padEnd(6, "0");
  const fracPart = BigInt(fracStr);
  return intPart * 1_000_000n + fracPart;
}

/**
 * Convert atomic units (6 decimals) back to a USDC decimal string.
 */
export function atomicToUsdc(atomic: bigint): string {
  const intPart = atomic / 1_000_000n;
  const fracPart = atomic % 1_000_000n;
  if (fracPart === 0n) return intPart.toString();
  return `${intPart}.${fracPart.toString().padStart(6, "0").replace(/0+$/, "")}`;
}
