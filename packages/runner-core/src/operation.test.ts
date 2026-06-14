import { describe, it, expect } from "vitest";
import {
  isTerminalOperationState,
  canTransitionOperationState,
  assertOperationStateTransition,
  OPERATION_ERROR_CODES,
  type OperationRecord,
  type OperationState,
} from "./operation";
import { RunnerError } from "./errors";

// ── Allowed Transitions Matrix ─────────────────────────────────────────

describe("canTransitionOperationState", () => {
  const allowed: [OperationState, OperationState][] = [
    ["created", "prepared"],
    ["created", "failed"],
    ["created", "cancelled"],
    ["prepared", "reserved"],
    ["prepared", "failed"],
    ["reserved", "executing"],
    ["reserved", "failed"],
    ["executing", "broadcast"],
    ["executing", "unknown"],
    ["executing", "failed"],
    ["executing", "cancelled"],
    ["broadcast", "confirmed"],
    ["broadcast", "unknown"],
    ["broadcast", "failed"],
    ["unknown", "confirmed"],
    ["unknown", "failed"],
  ];

  it.each(allowed)("allows %s → %s", (from, to) => {
    expect(canTransitionOperationState(from, to)).toBe(true);
  });
});

// ── Invalid Transitions ────────────────────────────────────────────────

describe("canTransitionOperationState (invalid)", () => {
  const invalid: [OperationState, OperationState, string][] = [
    ["confirmed", "executing", "terminal → executing"],
    ["failed", "confirmed", "terminal reverse"],
    ["cancelled", "broadcast", "cancelled → broadcast"],
    ["created", "confirmed", "skip to terminal"],
    ["prepared", "broadcast", "skip reserved+executing"],
    ["created", "executing", "skip prepared+reserved"],
    ["reserved", "confirmed", "skip executing+broadcast"],
    ["executing", "confirmed", "skip broadcast"],
  ];

  it.each(invalid)("rejects %s → %s (%s)", (from, to, _desc) => {
    expect(canTransitionOperationState(from, to)).toBe(false);
  });
});

// ── Terminal State Detection ───────────────────────────────────────────

describe("isTerminalOperationState", () => {
  it("confirmed is terminal", () => {
    expect(isTerminalOperationState("confirmed")).toBe(true);
  });

  it("failed is terminal", () => {
    expect(isTerminalOperationState("failed")).toBe(true);
  });

  it("cancelled is terminal", () => {
    expect(isTerminalOperationState("cancelled")).toBe(true);
  });

  const nonTerminal: OperationState[] = [
    "created",
    "prepared",
    "reserved",
    "executing",
    "broadcast",
    "unknown",
  ];

  it.each(nonTerminal)("%s is NOT terminal", (state) => {
    expect(isTerminalOperationState(state)).toBe(false);
  });
});

// ── Transition Assertion ───────────────────────────────────────────────

describe("assertOperationStateTransition", () => {
  it("does not throw for valid transition", () => {
    expect(() =>
      assertOperationStateTransition("created", "prepared")
    ).not.toThrow();
  });

  it("throws RunnerError for invalid transition", () => {
    try {
      assertOperationStateTransition("confirmed", "executing");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RunnerError);
      expect((e as RunnerError).code).toBe("INVALID_TRANSITION");
      expect((e as RunnerError).status).toBe(422);
      expect((e as RunnerError).message).toContain("confirmed");
      expect((e as RunnerError).message).toContain("executing");
    }
  });

  it("includes from/to in error details", () => {
    try {
      assertOperationStateTransition("cancelled", "broadcast");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as RunnerError).details).toEqual({
        from: "cancelled",
        to: "broadcast",
      });
    }
  });
});

// ── Error Codes Export ─────────────────────────────────────────────────

describe("OPERATION_ERROR_CODES", () => {
  it("contains all expected codes", () => {
    expect(OPERATION_ERROR_CODES).toContain("INVALID_TRANSITION");
    expect(OPERATION_ERROR_CODES).toContain("IDEMPOTENCY_CONFLICT");
    expect(OPERATION_ERROR_CODES).toContain("LOCK_CONFLICT");
    expect(OPERATION_ERROR_CODES).toContain("BROADCAST_FAILED");
    expect(OPERATION_ERROR_CODES).toContain("CONFIRMATION_TIMEOUT");
    expect(OPERATION_ERROR_CODES).toContain("RECONCILIATION_REQUIRED");
    expect(OPERATION_ERROR_CODES).toContain("UNKNOWN_TX_STATE");
    expect(OPERATION_ERROR_CODES).toHaveLength(9);
  });
});

// ── OperationRecord Construction ───────────────────────────────────────

describe("OperationRecord", () => {
  it("can be created with required fields", () => {
    const record: OperationRecord = {
      operationId: "op-001",
      idempotencyKey: "idem-abc-123",
      toolName: "x402.pay",
      paramsHash: "0xsha256params",
      state: "created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(record.operationId).toBe("op-001");
    expect(record.state).toBe("created");
  });

  it("can include optional fields", () => {
    const record: OperationRecord = {
      operationId: "op-002",
      idempotencyKey: "idem-def-456",
      toolName: "erc8183.submit",
      state: "broadcast",
      actor: "agent-1",
      role: "provider",
      agentId: "agent-1",
      walletAddress: "0x3c46624b62fa4cf3d63e6bdd60dc1b79a43ceb22",
      chainId: 5042002,
      contractAddress: "0x0747EEf0706327138c69792bF28Cd525089e4583",
      method: "submit",
      paramsHash: "0xabc123",
      amount: "0.01",
      txHash: "0xdef456",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(record.walletAddress).toBeDefined();
    expect(record.txHash).toBeDefined();
  });

  it("can carry error info", () => {
    const record: OperationRecord = {
      operationId: "op-003",
      idempotencyKey: "idem-ghi-789",
      toolName: "x402.pay",
      paramsHash: "0xsha256error",
      state: "failed",
      errorCode: "BROADCAST_FAILED",
      errorMessage: "insufficient gas",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(record.errorCode).toBe("BROADCAST_FAILED");
    expect(record.errorMessage).toBe("insufficient gas");
  });
});
