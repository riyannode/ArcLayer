/**
 * Tests for EvaluationVerdictV1 — evaluator verdict schema.
 *
 * Acceptance criteria:
 *   - canonical encoding deterministic
 *   - settlement decision logic correct
 *   - hash verification works
 *   - rejects invalid schemas
 */

import { describe, it, expect } from "vitest";
import {
  encodeEvaluationVerdict,
  decodeEvaluationVerdict,
  validateEvaluationVerdict,
  determineSettlementAction,
  verifyEvaluatedHash,
  AUTO_SETTLEMENT_CONFIDENCE_THRESHOLD,
  type EvaluationVerdictV1,
} from "./evaluation-verdict";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeVerdict(overrides?: Partial<EvaluationVerdictV1>): EvaluationVerdictV1 {
  return {
    schema: "arclayer.evaluation",
    version: 1,
    decision: "complete",
    score: 95,
    confidence: 0.9,
    reason: "All criteria met with high quality output",
    evaluatedDeliverableHash: "0x" + "ab".repeat(32),
    evidence: [
      { criterionId: "c1", passed: true, explanation: "Found all reentrancy bugs" },
      { criterionId: "c2", passed: true, explanation: "Gas optimization suggestions were actionable" },
    ],
    ...overrides,
  };
}

// ── Encode ─────────────────────────────────────────────────────────────────

describe("encodeEvaluationVerdict", () => {
  it("produces deterministic output", () => {
    const v1 = makeVerdict();
    const v2: EvaluationVerdictV1 = {
      version: 1,
      evidence: [
        { explanation: "Found all reentrancy bugs", passed: true, criterionId: "c1" },
        { explanation: "Gas optimization suggestions were actionable", passed: true, criterionId: "c2" },
      ],
      score: 95,
      schema: "arclayer.evaluation",
      evaluatedDeliverableHash: "0x" + "ab".repeat(32),
      confidence: 0.9,
      reason: "All criteria met with high quality output",
      decision: "complete",
    };

    expect(encodeEvaluationVerdict(v1)).toBe(encodeEvaluationVerdict(v2));
  });

  it("produces valid JSON", () => {
    const v = makeVerdict();
    const encoded = encodeEvaluationVerdict(v);
    const parsed = JSON.parse(encoded);

    expect(parsed.schema).toBe("arclayer.evaluation");
    expect(parsed.version).toBe(1);
    expect(parsed.decision).toBe("complete");
  });
});

// ── Decode ─────────────────────────────────────────────────────────────────

describe("decodeEvaluationVerdict", () => {
  it("decodes valid verdict", () => {
    const v = makeVerdict();
    const encoded = encodeEvaluationVerdict(v);
    const decoded = decodeEvaluationVerdict(encoded);

    expect(decoded).not.toBeNull();
    expect(decoded!.decision).toBe("complete");
    expect(decoded!.score).toBe(95);
  });

  it("returns null for non-JSON", () => {
    expect(decodeEvaluationVerdict("not json")).toBeNull();
  });

  it("returns null for wrong schema", () => {
    const json = JSON.stringify({ schema: "other", version: 1 });
    expect(decodeEvaluationVerdict(json)).toBeNull();
  });
});

// ── Validate ───────────────────────────────────────────────────────────────

describe("validateEvaluationVerdict", () => {
  it("validates correct verdict", () => {
    const v = makeVerdict();
    const encoded = encodeEvaluationVerdict(v);
    const result = validateEvaluationVerdict(encoded);

    expect(result.valid).toBe(true);
    expect(result.verdict).not.toBeNull();
    expect(result.errors).toHaveLength(0);
  });

  it("reports errors for invalid verdict", () => {
    const result = validateEvaluationVerdict("not json");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ── Settlement Decision ────────────────────────────────────────────────────

describe("determineSettlementAction", () => {
  it("auto-completes when all mandatory criteria pass with high confidence", () => {
    const v = makeVerdict({ decision: "complete", score: 95, confidence: 0.95 });
    const action = determineSettlementAction(v, ["c1", "c2"]);
    expect(action).toBe("auto_complete");
  });

  it("auto-rejects when mandatory criteria fail with high confidence", () => {
    const v = makeVerdict({
      decision: "reject",
      score: 20,
      confidence: 0.85,
      evidence: [
        { criterionId: "c1", passed: false, explanation: "Reentrancy bug missed" },
        { criterionId: "c2", passed: true, explanation: "Gas suggestions ok" },
      ],
    });
    const action = determineSettlementAction(v, ["c1", "c2"]);
    expect(action).toBe("auto_reject");
  });

  it("returns manual_review for low confidence", () => {
    const v = makeVerdict({ confidence: 0.3 });
    const action = determineSettlementAction(v, ["c1", "c2"]);
    expect(action).toBe("manual_review");
  });

  it("returns manual_review for explicit manual_review decision", () => {
    const v = makeVerdict({ decision: "manual_review", confidence: 0.99 });
    const action = determineSettlementAction(v, ["c1", "c2"]);
    expect(action).toBe("manual_review");
  });

  it("returns manual_review when mandatory criteria missing from evidence", () => {
    const v = makeVerdict({
      evidence: [{ criterionId: "c1", passed: true, explanation: "ok" }],
    });
    const action = determineSettlementAction(v, ["c1", "c2"]);
    expect(action).toBe("manual_review");
  });

  it("returns manual_review when complete but mandatory criteria fail", () => {
    const v = makeVerdict({
      decision: "complete",
      score: 95,
      confidence: 0.95,
      evidence: [
        { criterionId: "c1", passed: false, explanation: "Failed" },
        { criterionId: "c2", passed: true, explanation: "ok" },
      ],
    });
    const action = determineSettlementAction(v, ["c1", "c2"]);
    expect(action).toBe("manual_review");
  });

  it("returns manual_review when reject but no mandatory criteria fail", () => {
    const v = makeVerdict({
      decision: "reject",
      score: 60,
      confidence: 0.8,
      evidence: [
        { criterionId: "c1", passed: true, explanation: "ok" },
        { criterionId: "c2", passed: true, explanation: "ok" },
      ],
    });
    const action = determineSettlementAction(v, ["c1", "c2"]);
    expect(action).toBe("manual_review");
  });

  it("returns manual_review when score too low for complete", () => {
    const v = makeVerdict({
      decision: "complete",
      score: 50, // below threshold
      confidence: 0.9,
    });
    const action = determineSettlementAction(v, ["c1", "c2"]);
    expect(action).toBe("manual_review");
  });
});

// ── Hash Verification ──────────────────────────────────────────────────────

describe("verifyEvaluatedHash", () => {
  it("returns true for matching hash", () => {
    const hash = ("0x" + "ab".repeat(32)) as `0x${string}`;
    const v = makeVerdict({ evaluatedDeliverableHash: hash });
    expect(verifyEvaluatedHash(v, hash)).toBe(true);
  });

  it("returns false for mismatched hash", () => {
    const hash1 = ("0x" + "ab".repeat(32)) as `0x${string}`;
    const hash2 = ("0x" + "cd".repeat(32)) as `0x${string}`;
    const v = makeVerdict({ evaluatedDeliverableHash: hash1 });
    expect(verifyEvaluatedHash(v, hash2)).toBe(false);
  });

  it("case-insensitive comparison", () => {
    const hash = ("0x" + "AB".repeat(32)) as `0x${string}`;
    const lower = ("0x" + "ab".repeat(32)) as `0x${string}`;
    const v = makeVerdict({ evaluatedDeliverableHash: hash });
    expect(verifyEvaluatedHash(v, lower)).toBe(true);
  });
});
