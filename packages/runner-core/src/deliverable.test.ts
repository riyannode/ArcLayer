/**
 * Tests for CanonicalDeliverableV1 — provider deliverable schema.
 *
 * Acceptance criteria:
 *   - canonical encoding deterministic
 *   - deliverable hash matches existing ERC-8183 Keccak behavior
 *   - verify hash works correctly
 *   - rejects oversized payloads
 *   - rejects too many artifacts
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizeDeliverable,
  computeErc8183DeliverableHash,
  hashDeliverable,
  verifyErc8183DeliverableHash,
  decodeDeliverable,
  isCanonicalDeliverable,
  type CanonicalDeliverableV1,
} from "./deliverable";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeDeliverable(overrides?: Partial<CanonicalDeliverableV1>): CanonicalDeliverableV1 {
  return {
    schema: "arclayer.deliverable",
    version: 1,
    jobId: "42",
    providerAgentId: "agent-001",
    output: { result: "No vulnerabilities found", details: "Static analysis complete" },
    artifacts: [
      { name: "report.pdf", uri: "https://example.com/report.pdf", contentType: "application/pdf" },
    ],
    runtime: {
      taskId: "task-abc-123",
      completedAt: "2026-06-14T12:00:00Z",
    },
    ...overrides,
  };
}

// ── Canonicalize determinism ───────────────────────────────────────────────

describe("canonicalizeDeliverable", () => {
  it("produces deterministic output regardless of key order", () => {
    const d1 = makeDeliverable();
    const d2: CanonicalDeliverableV1 = {
      version: 1,
      runtime: { completedAt: "2026-06-14T12:00:00Z", taskId: "task-abc-123" },
      artifacts: [{ name: "report.pdf", contentType: "application/pdf", uri: "https://example.com/report.pdf" }],
      output: { details: "Static analysis complete", result: "No vulnerabilities found" },
      providerAgentId: "agent-001",
      schema: "arclayer.deliverable",
      jobId: "42",
    };

    const c1 = canonicalizeDeliverable(d1);
    const c2 = canonicalizeDeliverable(d2);

    expect(c1).toBe(c2);
  });

  it("produces valid JSON", () => {
    const d = makeDeliverable();
    const canonical = canonicalizeDeliverable(d);
    const parsed = JSON.parse(canonical);

    expect(parsed.schema).toBe("arclayer.deliverable");
    expect(parsed.version).toBe(1);
    expect(parsed.jobId).toBe("42");
  });

  it("rejects too many artifacts", () => {
    const artifacts = Array.from({ length: 33 }, (_, i) => ({
      name: `artifact-${i}`,
    }));
    const d = makeDeliverable({ artifacts });
    expect(() => canonicalizeDeliverable(d)).toThrow();
  });

  it("rejects invalid schema", () => {
    const d = makeDeliverable({ schema: "wrong" as any });
    expect(() => canonicalizeDeliverable(d)).toThrow();
  });
});

// ── ERC-8183 Hash ──────────────────────────────────────────────────────────

describe("computeErc8183DeliverableHash", () => {
  it("produces 0x-prefixed 66-char keccak256 hash", () => {
    const d = makeDeliverable();
    const canonical = canonicalizeDeliverable(d);
    const hash = computeErc8183DeliverableHash(canonical);

    expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  it("same input produces same hash", () => {
    const d = makeDeliverable();
    const canonical = canonicalizeDeliverable(d);
    const hash1 = computeErc8183DeliverableHash(canonical);
    const hash2 = computeErc8183DeliverableHash(canonical);

    expect(hash1).toBe(hash2);
  });

  it("different inputs produce different hashes", () => {
    const d1 = makeDeliverable({ jobId: "42" });
    const d2 = makeDeliverable({ jobId: "43" });
    const h1 = computeErc8183DeliverableHash(canonicalizeDeliverable(d1));
    const h2 = computeErc8183DeliverableHash(canonicalizeDeliverable(d2));

    expect(h1).not.toBe(h2);
  });
});

// ── hashDeliverable convenience ────────────────────────────────────────────

describe("hashDeliverable", () => {
  it("returns both canonical payload and hash", () => {
    const d = makeDeliverable();
    const result = hashDeliverable(d);

    expect(result.canonicalPayload).toBeTruthy();
    expect(result.deliverableHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(verifyErc8183DeliverableHash(result.canonicalPayload, result.deliverableHash)).toBe(true);
  });
});

// ── Verify ─────────────────────────────────────────────────────────────────

describe("verifyErc8183DeliverableHash", () => {
  it("returns true for matching hash", () => {
    const d = makeDeliverable();
    const { canonicalPayload, deliverableHash } = hashDeliverable(d);
    expect(verifyErc8183DeliverableHash(canonicalPayload, deliverableHash)).toBe(true);
  });

  it("returns false for wrong hash", () => {
    const d = makeDeliverable();
    const canonical = canonicalizeDeliverable(d);
    expect(verifyErc8183DeliverableHash(canonical, "0x" + "00".repeat(32))).toBe(false);
  });

  it("case-insensitive comparison", () => {
    const d = makeDeliverable();
    const { canonicalPayload, deliverableHash } = hashDeliverable(d);
    const upper = deliverableHash.toUpperCase() as `0x${string}`;
    expect(verifyErc8183DeliverableHash(canonicalPayload, upper)).toBe(true);
  });
});

// ── Decode ─────────────────────────────────────────────────────────────────

describe("decodeDeliverable", () => {
  it("decodes valid canonical payload", () => {
    const d = makeDeliverable();
    const canonical = canonicalizeDeliverable(d);
    const decoded = decodeDeliverable(canonical);

    expect(decoded).not.toBeNull();
    expect(decoded!.jobId).toBe("42");
    expect(decoded!.providerAgentId).toBe("agent-001");
  });

  it("returns null for invalid JSON", () => {
    expect(decodeDeliverable("not json")).toBeNull();
  });

  it("returns null for wrong schema", () => {
    const json = JSON.stringify({ schema: "other", version: 1 });
    expect(decodeDeliverable(json)).toBeNull();
  });
});

// ── Guard ──────────────────────────────────────────────────────────────────

describe("isCanonicalDeliverable", () => {
  it("returns true for valid deliverable", () => {
    const canonical = canonicalizeDeliverable(makeDeliverable());
    expect(isCanonicalDeliverable(canonical)).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isCanonicalDeliverable("plain text")).toBe(false);
  });
});
