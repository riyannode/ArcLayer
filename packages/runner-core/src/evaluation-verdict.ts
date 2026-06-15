/**
 * EvaluationVerdictV1 — Evaluator verdict schema for ERC-8183 settlement.
 *
 * Encodes evaluation decision, score, evidence, and the evaluated deliverable hash
 * into a deterministic format used for:
 *   - On-chain settlement (complete/reject)
 *   - Reputation publication (ERC-8004 feedback)
 *   - Manual review escalation
 *   - Audit trail
 *
 * Design:
 *   - Deterministic canonical JSON
 *   - Decision must be "complete", "reject", or "manual_review"
 *   - Score: 0-100 normalized
 *   - Confidence: 0-1 normalized
 *   - Evidence links back to acceptance criteria IDs
 *   - evaluatedDeliverableHash must match the submitted on-chain hash
 */

import { z } from "zod";
import type { Hex } from "viem";

// ── Schemas ────────────────────────────────────────────────────────────────

const EvidenceItemSchema = z.object({
  criterionId: z.string().min(1).max(128),
  passed: z.boolean(),
  explanation: z.string().min(1).max(4096),
});

/**
 * EvaluationVerdictV1 — the canonical evaluation result format.
 *
 * The `schema` field MUST be "arclayer.evaluation" and `version` MUST be 1.
 */
export const EvaluationVerdictV1Schema = z.object({
  schema: z.literal("arclayer.evaluation"),
  version: z.literal(1),

  decision: z.enum(["complete", "reject", "manual_review"]),

  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),

  reason: z.string().min(1).max(4096),

  evaluatedDeliverableHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "must be a valid keccak256 hash"),

  evidence: z.array(EvidenceItemSchema).min(1).max(32),
});

export type EvaluationVerdictV1 = z.infer<typeof EvaluationVerdictV1Schema>;

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

// ── Constants ──────────────────────────────────────────────────────────────

const EVALUATION_SCHEMA = "arclayer.evaluation";
const EVALUATION_VERSION = 1;

/** Minimum confidence for auto-complete/reject (below this → manual review) */
export const AUTO_SETTLEMENT_CONFIDENCE_THRESHOLD = 0.7;

/** Minimum score for auto-complete (all mandatory criteria must pass) */
export const AUTO_COMPLETE_SCORE_THRESHOLD = 80;

// ── Canonical JSON ─────────────────────────────────────────────────────────

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
 * Encode a validated EvaluationVerdictV1 into deterministic canonical JSON.
 */
export function encodeEvaluationVerdict(verdict: EvaluationVerdictV1): string {
  const validated = EvaluationVerdictV1Schema.parse(verdict);
  return canonicalStringify(validated);
}

// ── Decode ─────────────────────────────────────────────────────────────────

/**
 * Decode a JSON string into a validated EvaluationVerdictV1.
 * Returns null if the input is not a valid evaluation verdict.
 */
export function decodeEvaluationVerdict(raw: string): EvaluationVerdictV1 | null {
  if (!raw || typeof raw !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.schema !== EVALUATION_SCHEMA || obj.version !== EVALUATION_VERSION) return null;

  const result = EvaluationVerdictV1Schema.safeParse(parsed);
  if (!result.success) return null;

  return result.data;
}

// ── Validate ───────────────────────────────────────────────────────────────

export type EvaluationValidationResult = {
  valid: boolean;
  verdict: EvaluationVerdictV1 | null;
  errors: string[];
};

/**
 * Full validation of an evaluation verdict string.
 * Returns structured result with errors array.
 */
export function validateEvaluationVerdict(raw: string): EvaluationValidationResult {
  if (!raw || typeof raw !== "string") {
    return { valid: false, verdict: null, errors: ["verdict is empty or not a string"] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, verdict: null, errors: ["verdict is not valid JSON"] };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, verdict: null, errors: ["verdict JSON is not an object"] };
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.schema !== EVALUATION_SCHEMA) {
    return {
      valid: false,
      verdict: null,
      errors: [`expected schema "${EVALUATION_SCHEMA}", got "${obj.schema}"`],
    };
  }
  if (obj.version !== EVALUATION_VERSION) {
    return {
      valid: false,
      verdict: null,
      errors: [`expected version ${EVALUATION_VERSION}, got ${obj.version}`],
    };
  }

  const result = EvaluationVerdictV1Schema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    return { valid: false, verdict: null, errors };
  }

  return { valid: true, verdict: result.data, errors: [] };
}

// ── Settlement Decision Helpers ────────────────────────────────────────────

export type SettlementDecision = "auto_complete" | "auto_reject" | "manual_review";

/**
 * Determine the settlement action based on a validated verdict.
 *
 * Auto-complete allowed when:
 *   - All mandatory criteria pass
 *   - Hash verification passes
 *   - Verdict schema valid
 *   - Confidence >= threshold
 *
 * Auto-reject allowed when:
 *   - One or more mandatory criteria explicitly fail
 *   - Evidence identifies each failed criterion
 *   - Hash verification passes
 *   - Confidence >= threshold
 *
 * Manual review required for everything else:
 *   - Low confidence
 *   - Ambiguous evidence
 *   - Manual_review decision
 *   - Hash mismatch (caller must verify separately)
 */
export function determineSettlementAction(
  verdict: EvaluationVerdictV1,
  mandatoryCriteriaIds: string[],
): SettlementDecision {
  // Explicit manual_review always goes to manual review
  if (verdict.decision === "manual_review") return "manual_review";

  // Confidence gate
  if (verdict.confidence < AUTO_SETTLEMENT_CONFIDENCE_THRESHOLD) {
    return "manual_review";
  }

  // Build evidence lookup
  const evidenceMap = new Map(verdict.evidence.map((e) => [e.criterionId, e]));

  // Check all mandatory criteria have evidence
  const missingEvidence = mandatoryCriteriaIds.filter((id) => !evidenceMap.has(id));
  if (missingEvidence.length > 0) return "manual_review";

  // Check all mandatory criteria passed
  const failedMandatory = mandatoryCriteriaIds.filter((id) => {
    const ev = evidenceMap.get(id);
    return ev && !ev.passed;
  });

  if (verdict.decision === "complete") {
    // Auto-complete: all mandatory must pass
    if (failedMandatory.length > 0) return "manual_review";
    if (verdict.score < AUTO_COMPLETE_SCORE_THRESHOLD) return "manual_review";
    return "auto_complete";
  }

  if (verdict.decision === "reject") {
    // Auto-reject: at least one mandatory must explicitly fail
    if (failedMandatory.length === 0) return "manual_review";
    return "auto_reject";
  }

  return "manual_review";
}

// ── Hash Verification ──────────────────────────────────────────────────────

/**
 * Verify that the evaluated deliverable hash matches the expected submitted hash.
 *
 * Three-way check:
 *   verdict.evaluatedDeliverableHash
 *   == stored deliverable hash
 *   == on-chain submitted hash
 */
export function verifyEvaluatedHash(
  verdict: EvaluationVerdictV1,
  expectedHash: Hex,
): boolean {
  return verdict.evaluatedDeliverableHash.toLowerCase() === expectedHash.toLowerCase();
}
