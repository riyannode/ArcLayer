import { describe, it, expect } from "vitest";
import {
  assertSubmittableRuntimeResult,
  isSubmittableProviderResult,
  type RuntimeResult,
} from "./types";
import { RunnerError } from "./errors";

function makeResult(status: string): RuntimeResult {
  return {
    ok: true,
    status: status as RuntimeResult["status"],
    artifacts: [],
    paymentRequests: [],
    actionRequests: [],
  };
}

describe("assertSubmittableRuntimeResult", () => {
  it("passes for completed status", () => {
    expect(() => assertSubmittableRuntimeResult(makeResult("completed"))).not.toThrow();
  });

  it("throws RUNTIME_NOT_SUBMITTABLE for failed", () => {
    expect(() => assertSubmittableRuntimeResult(makeResult("failed"))).toThrowError(RunnerError);
    try {
      assertSubmittableRuntimeResult(makeResult("failed"));
    } catch (e) {
      expect((e as RunnerError).code).toBe("RUNTIME_NOT_SUBMITTABLE");
      expect((e as RunnerError).message).toContain("failed");
    }
  });

  it("throws RUNTIME_NOT_SUBMITTABLE for needs_payment", () => {
    expect(() => assertSubmittableRuntimeResult(makeResult("needs_payment"))).toThrowError(RunnerError);
    try {
      assertSubmittableRuntimeResult(makeResult("needs_payment"));
    } catch (e) {
      expect((e as RunnerError).code).toBe("RUNTIME_NOT_SUBMITTABLE");
      expect((e as RunnerError).message).toContain("needs_payment");
    }
  });

  it("throws RUNTIME_NOT_SUBMITTABLE for needs_action", () => {
    expect(() => assertSubmittableRuntimeResult(makeResult("needs_action"))).toThrowError(RunnerError);
    try {
      assertSubmittableRuntimeResult(makeResult("needs_action"));
    } catch (e) {
      expect((e as RunnerError).code).toBe("RUNTIME_NOT_SUBMITTABLE");
      expect((e as RunnerError).message).toContain("needs_action");
    }
  });

  it("throws with status 422", () => {
    try {
      assertSubmittableRuntimeResult(makeResult("needs_payment"));
    } catch (e) {
      expect((e as RunnerError).status).toBe(422);
    }
  });
});

describe("isSubmittableProviderResult", () => {
  it("returns true for completed", () => {
    expect(isSubmittableProviderResult(makeResult("completed"))).toBe(true);
  });

  it("returns false for failed", () => {
    expect(isSubmittableProviderResult(makeResult("failed"))).toBe(false);
  });

  it("returns false for needs_payment", () => {
    expect(isSubmittableProviderResult(makeResult("needs_payment"))).toBe(false);
  });

  it("returns false for needs_action", () => {
    expect(isSubmittableProviderResult(makeResult("needs_action"))).toBe(false);
  });
});
