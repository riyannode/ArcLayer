/**
 * Approval types and hash unit tests.
 * Store tests live in apps/arclayer-runner/src/approval-store.test.ts
 */

import { describe, it, expect } from "vitest";
import { computeRequestHash, isTransitionAllowed } from "./approval";

describe("computeRequestHash", () => {
  it("is deterministic for same input", () => {
    const params = { a: "1", b: "2" };
    const hash1 = computeRequestHash(params);
    const hash2 = computeRequestHash(params);
    expect(hash1).toBe(hash2);
  });

  it("is deterministic regardless of key order", () => {
    const hash1 = computeRequestHash({ a: "1", b: "2" });
    const hash2 = computeRequestHash({ b: "2", a: "1" });
    expect(hash1).toBe(hash2);
  });

  it("differs for different inputs", () => {
    const hash1 = computeRequestHash({ a: "1" });
    const hash2 = computeRequestHash({ a: "2" });
    expect(hash1).not.toBe(hash2);
  });

  it("handles nested objects deterministically", () => {
    const hash1 = computeRequestHash({ outer: { z: 1, a: 2 } });
    const hash2 = computeRequestHash({ outer: { a: 2, z: 1 } });
    expect(hash1).toBe(hash2);
  });

  it("produces a 64-char hex string (SHA-256)", () => {
    const hash = computeRequestHash({ test: true });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("handles null and undefined", () => {
    const hash1 = computeRequestHash({ a: null, b: undefined });
    const hash2 = computeRequestHash({ a: null, b: undefined });
    expect(hash1).toBe(hash2);
  });
});

describe("isTransitionAllowed", () => {
  it("allows pending → executing", () => {
    expect(isTransitionAllowed("pending", "executing")).toBe(true);
  });

  it("allows pending → rejected", () => {
    expect(isTransitionAllowed("pending", "rejected")).toBe(true);
  });

  it("allows pending → cancelled", () => {
    expect(isTransitionAllowed("pending", "cancelled")).toBe(true);
  });

  it("allows pending → expired", () => {
    expect(isTransitionAllowed("pending", "expired")).toBe(true);
  });

  it("allows executing → executed", () => {
    expect(isTransitionAllowed("executing", "executed")).toBe(true);
  });

  it("allows executing → failed", () => {
    expect(isTransitionAllowed("executing", "failed")).toBe(true);
  });

  it("blocks executed → anything", () => {
    expect(isTransitionAllowed("executed", "executing")).toBe(false);
    expect(isTransitionAllowed("executed", "failed")).toBe(false);
  });

  it("blocks rejected → anything", () => {
    expect(isTransitionAllowed("rejected", "executing")).toBe(false);
  });

  it("blocks cancelled → anything", () => {
    expect(isTransitionAllowed("cancelled", "executing")).toBe(false);
  });

  it("blocks expired → anything", () => {
    expect(isTransitionAllowed("expired", "executing")).toBe(false);
  });

  it("blocks failed → anything", () => {
    expect(isTransitionAllowed("failed", "executing")).toBe(false);
    expect(isTransitionAllowed("failed", "pending")).toBe(false);
  });
});
