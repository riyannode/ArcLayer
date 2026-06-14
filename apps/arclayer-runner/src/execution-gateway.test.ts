import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecutionGateway, assertGatewayWriteSucceeded } from "./execution-gateway";
import type { WriteOperationKind, WriteOperationInput, CircleCliExecuteFn } from "./execution-gateway";
import type { CircleCliResult } from "@arclayer/circle-cli-adapter";
import { RunnerError } from "@arclayer/runner-core";

// ── Mocks ─────────────────────────────────────────────────────────────

function makeMockCircleCliResult(overrides: Partial<CircleCliResult> = {}): CircleCliResult {
  return {
    command: "circle",
    args: ["wallet", "execute", "submit(uint256,bytes32,bytes)", "1", "0xabc", "0x", "--contract", "0x0747", "--address", "0x3c46", "--chain", "ARC-TESTNET", "--output", "json"],
    stdout: JSON.stringify({ txHash: "0x" + "a".repeat(64), status: "confirmed" }),
    stderr: "",
    json: { txHash: "0x" + "a".repeat(64), status: "confirmed" },
    ...overrides,
  };
}

/** Result with txHash but no explicit status — should classify as broadcast */
function makeBroadcastCircleCliResult(): CircleCliResult {
  return {
    command: "circle",
    args: ["wallet", "execute", "submit(uint256,bytes32,bytes)", "1", "0xabc", "0x"],
    stdout: JSON.stringify({ txHash: "0x" + "a".repeat(64) }),
    stderr: "",
    json: { txHash: "0x" + "a".repeat(64) },
  };
}

function makeMockCircle() {
  return {
    executeErc8183Write: vi.fn().mockResolvedValue(makeMockCircleCliResult()),
    approveUsdc: vi.fn().mockResolvedValue(makeMockCircleCliResult()),
    executeAllowedArcWrite: vi.fn().mockResolvedValue(makeMockCircleCliResult()),
    queryContract: vi.fn().mockResolvedValue(makeMockCircleCliResult()),
  } as any;
}

function makeMockReceipts() {
  return {
    append: vi.fn().mockResolvedValue({ id: "receipt-1" }),
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
  } as any;
}

function makeInput(overrides: Partial<WriteOperationInput> = {}): WriteOperationInput {
  return {
    kind: "createJob" as WriteOperationKind,
    idempotencyKey: "idem-key-1",
    paramsHash: "0x" + "b".repeat(64),
    walletAddress: "0x3c46624b62fa4cf3d63e6bdd60dc1b79a43ceb22",
    chain: "ARC-TESTNET",
    contractAddress: "0x0747EEf0706327138c69792bF28Cd525089e4583",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("ExecutionGateway", () => {
  let gateway: ExecutionGateway;
  let circle: ReturnType<typeof makeMockCircle>;
  let receipts: ReturnType<typeof makeMockReceipts>;

  beforeEach(() => {
    circle = makeMockCircle();
    receipts = makeMockReceipts();
    gateway = new ExecutionGateway(circle, receipts, {
      agentId: "agent-1",
      circleWalletAddress: "0x3c46624b62fa4cf3d63e6bdd60dc1b79a43ceb22",
      chain: "ARC-TESTNET",
    });
  });

  // ── State Transition Flow ──────────────────────────────────────────

  describe("operation state transitions", () => {
    it("transitions created → prepared → reserved → executing → broadcast → confirmed", async () => {
      const states: string[] = [];
      const originalTransition = (gateway as any).transitionState.bind(gateway);
      (gateway as any).transitionState = (opId: string, to: string) => {
        states.push(to);
        return originalTransition(opId, to);
      };

      const executeFn: CircleCliExecuteFn = async () => makeMockCircleCliResult();
      const result = await gateway.execute(makeInput(), executeFn);

      expect(result.ok).toBe(true);
      expect(result.state).toBe("confirmed");
      expect(states).toEqual(["prepared", "reserved", "executing", "broadcast", "confirmed"]);
    });

    it("transitions created → failed when wallet address is missing", async () => {
      const gw = new ExecutionGateway(circle, receipts, {
        agentId: "agent-1",
        chain: "ARC-TESTNET",
        // No circleWalletAddress
      });

      const executeFn: CircleCliExecuteFn = vi.fn();
      const result = await gw.execute(
        makeInput({ walletAddress: "" }),
        executeFn
      );

      expect(result.ok).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.errorCode).toBe("BROADCAST_FAILED");
      expect(executeFn).not.toHaveBeenCalled();
    });

    it("transitions executing → failed when Circle CLI throws non-timeout error", async () => {
      const executeFn: CircleCliExecuteFn = async () => {
        throw new Error("Insufficient funds in wallet");
      };

      const result = await gateway.execute(makeInput(), executeFn);

      expect(result.ok).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.errorCode).toBe("BROADCAST_FAILED");
    });

    it("transitions executing → unknown when Circle CLI times out", async () => {
      const executeFn: CircleCliExecuteFn = async () => {
        const err = new Error("Operation timed out");
        err.name = "AbortError";
        throw err;
      };

      const result = await gateway.execute(makeInput(), executeFn);

      expect(result.ok).toBe(false);
      expect(result.state).toBe("unknown");
      expect(result.errorCode).toBe("UNKNOWN_TX_STATE");
    });

    it("transitions executing → unknown when Circle CLI timeout message", async () => {
      const executeFn: CircleCliExecuteFn = async () => {
        throw new Error("ETIMEDOUT: connection timeout");
      };

      const result = await gateway.execute(makeInput(), executeFn);

      expect(result.ok).toBe(false);
      expect(result.state).toBe("unknown");
      expect(result.errorCode).toBe("UNKNOWN_TX_STATE");
    });
  });

  // ── Idempotency ────────────────────────────────────────────────────

  describe("idempotency", () => {
    it("returns idempotent result for same idempotencyKey + same paramsHash", async () => {
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());

      // First execution
      const result1 = await gateway.execute(makeInput(), executeFn);
      expect(result1.ok).toBe(true);
      expect(result1.state).toBe("confirmed");

      // Second execution with same key + same params
      const result2 = await gateway.execute(makeInput(), executeFn);
      expect(result2.ok).toBe(true);
      expect(result2.state).toBe("confirmed");
      expect(result2.idempotent).toBe(true);

      // executeFn should only be called once
      expect(executeFn).toHaveBeenCalledTimes(1);
    });

    it("throws IDEMPOTENCY_CONFLICT for same idempotencyKey + different paramsHash", async () => {
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());

      // First execution
      await gateway.execute(makeInput(), executeFn);

      // Second execution with same key but different params
      await expect(
        gateway.execute(
          makeInput({ paramsHash: "0x" + "c".repeat(64) }),
          executeFn
        )
      ).rejects.toThrow(/Idempotency conflict/);
    });

    it("allows re-execution after failed operation with same key+params", async () => {
      // First execution fails
      const failFn: CircleCliExecuteFn = async () => {
        throw new Error("Insufficient funds");
      };
      const result1 = await gateway.execute(makeInput(), failFn);
      expect(result1.state).toBe("failed");

      // Second execution with same key+params should succeed
      const successFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());
      const result2 = await gateway.execute(makeInput(), successFn);
      expect(result2.state).toBe("confirmed");
      expect(result2.idempotent).toBeUndefined();
      expect(successFn).toHaveBeenCalledTimes(1);
    });

    it("throws OPERATION_IN_PROGRESS when operation is still executing", async () => {
      // Create a gateway where we can control timing
      let resolveFirst: () => void;
      const firstExecution = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      let callCount = 0;
      const slowExecuteFn: CircleCliExecuteFn = async () => {
        callCount++;
        if (callCount === 1) {
          await firstExecution;
          return makeMockCircleCliResult();
        }
        return makeMockCircleCliResult();
      };

      // Start first execution (won't complete until we resolve)
      const promise1 = gateway.execute(makeInput(), slowExecuteFn);

      // Wait a tick for the state to be set to executing
      await new Promise((r) => setTimeout(r, 10));

      // Second execution should get OPERATION_IN_PROGRESS
      await expect(
        gateway.execute(makeInput(), slowExecuteFn)
      ).rejects.toThrow(/already in state executing/);

      // Clean up: resolve the first execution
      resolveFirst!();
      await promise1;
    });
  });

  // ── Broadcast Classification ────────────────────────────────────────

  describe("broadcast classification", () => {
    it("classifies txHash without explicit status as broadcast (non-terminal)", async () => {
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeBroadcastCircleCliResult());
      const result = await gateway.execute(makeInput(), executeFn);

      expect(result.state).toBe("broadcast");
      expect(result.ok).toBe(false); // broadcast is not confirmed
      expect(result.txHash).toBeDefined();
    });

    it("broadcast state blocks re-execution with OPERATION_IN_PROGRESS", async () => {
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeBroadcastCircleCliResult());

      // First execution → broadcast
      const result1 = await gateway.execute(makeInput(), executeFn);
      expect(result1.state).toBe("broadcast");

      // Retry with same key+params → should be blocked
      await expect(
        gateway.execute(makeInput(), executeFn)
      ).rejects.toThrow(/already in state broadcast/);
    });
  });

  // ── Unknown State Blocks Retry ──────────────────────────────────────

  describe("unknown state safety", () => {
    it("throws RECONCILIATION_REQUIRED when retrying unknown state", async () => {
      // First execution → unknown (timeout)
      const timeoutFn: CircleCliExecuteFn = async () => {
        const err = new Error("Operation timed out");
        err.name = "AbortError";
        throw err;
      };
      const result1 = await gateway.execute(makeInput(), timeoutFn);
      expect(result1.state).toBe("unknown");

      // Retry with same key+params → RECONCILIATION_REQUIRED
      await expect(
        gateway.execute(makeInput(), vi.fn())
      ).rejects.toThrow(/Reconciliation required/);
    });

    it("unknown state does NOT delete old record on retry", async () => {
      const timeoutFn: CircleCliExecuteFn = async () => {
        const err = new Error("timeout");
        err.name = "AbortError";
        throw err;
      };
      const result1 = await gateway.execute(makeInput(), timeoutFn);
      const opId = result1.operationId;

      // Retry throws
      await expect(
        gateway.execute(makeInput(), vi.fn())
      ).rejects.toThrow(/Reconciliation required/);

      // Original record still exists
      const record = gateway.getOperation(opId);
      expect(record).toBeDefined();
      expect(record!.state).toBe("unknown");
      expect(gateway.operationCount).toBe(1); // no new record created
    });
  });

  // ── Stable Idempotency Key (approveUsdc pattern) ──────────────────

  describe("stable idempotency key for approvals", () => {
    it("retry with same stable key after unknown throws RECONCILIATION_REQUIRED", async () => {
      // Simulate approveUsdc with a stable caller-provided key
      const stableKey = "approveUsdc:job-42:0.01";
      const input = makeInput({ idempotencyKey: stableKey });

      // First execution → unknown (timeout)
      const timeoutFn: CircleCliExecuteFn = async () => {
        const err = new Error("timeout");
        err.name = "AbortError";
        throw err;
      };
      const result1 = await gateway.execute(input, timeoutFn);
      expect(result1.state).toBe("unknown");

      // Retry with SAME stable key → blocked
      await expect(
        gateway.execute(input, vi.fn())
      ).rejects.toThrow(/Reconciliation required/);

      // Original record preserved
      expect(gateway.operationCount).toBe(1);
    });

    it("retry with same stable key after broadcast throws OPERATION_IN_PROGRESS", async () => {
      const stableKey = "approveUsdc:job-42:0.01";
      const input = makeInput({ idempotencyKey: stableKey });

      // First execution → broadcast (txHash, no explicit confirmation)
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeBroadcastCircleCliResult());
      const result1 = await gateway.execute(input, executeFn);
      expect(result1.state).toBe("broadcast");

      // Retry with SAME stable key → blocked
      await expect(
        gateway.execute(input, vi.fn())
      ).rejects.toThrow(/already in state broadcast/);
    });

    it("different stable key treated as separate intentional approval", async () => {
      const input1 = makeInput({ idempotencyKey: "approveUsdc:job-42:0.01" });
      const input2 = makeInput({ idempotencyKey: "approveUsdc:job-99:0.01" });

      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());

      // Both should succeed independently
      const result1 = await gateway.execute(input1, executeFn);
      const result2 = await gateway.execute(input2, executeFn);

      expect(result1.state).toBe("confirmed");
      expect(result2.state).toBe("confirmed");
      expect(result1.operationId).not.toBe(result2.operationId);
      expect(executeFn).toHaveBeenCalledTimes(2);
    });
  });

  // ── assertGatewayWriteSucceeded ────────────────────────────────────

  describe("assertGatewayWriteSucceeded", () => {
    it("confirmed result does not throw", async () => {
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());
      const result = await gateway.execute(makeInput(), executeFn);
      expect(result.state).toBe("confirmed");
      expect(() => assertGatewayWriteSucceeded(result)).not.toThrow();
    });

    it("broadcast result throws OPERATION_IN_PROGRESS", async () => {
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeBroadcastCircleCliResult());
      const result = await gateway.execute(makeInput(), executeFn);
      expect(result.state).toBe("broadcast");
      try {
        assertGatewayWriteSucceeded(result);
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(RunnerError);
        expect((e as RunnerError).code).toBe("OPERATION_IN_PROGRESS");
        expect((e as RunnerError).status).toBe(409);
        expect((e as RunnerError).details).toMatchObject({
          operationId: result.operationId,
          operationState: "broadcast",
        });
      }
    });

    it("unknown result throws RECONCILIATION_REQUIRED", async () => {
      const executeFn: CircleCliExecuteFn = async () => {
        const err = new Error("timeout");
        err.name = "AbortError";
        throw err;
      };
      const result = await gateway.execute(makeInput(), executeFn);
      expect(result.state).toBe("unknown");
      try {
        assertGatewayWriteSucceeded(result);
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(RunnerError);
        expect((e as RunnerError).code).toBe("RECONCILIATION_REQUIRED");
        expect((e as RunnerError).status).toBe(409);
        expect((e as RunnerError).details).toMatchObject({
          operationId: result.operationId,
          operationState: "unknown",
        });
      }
    });

    it("failed result throws BROADCAST_FAILED with metadata", async () => {
      const executeFn: CircleCliExecuteFn = async () => {
        throw new Error("Insufficient funds");
      };
      const result = await gateway.execute(makeInput(), executeFn);
      expect(result.state).toBe("failed");
      try {
        assertGatewayWriteSucceeded(result);
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(RunnerError);
        expect((e as RunnerError).code).toBe("BROADCAST_FAILED");
        expect((e as RunnerError).details).toMatchObject({
          operationId: result.operationId,
          operationState: "failed",
        });
      }
    });

    it("confirmed idempotent replay does not throw", async () => {
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());

      // First execution → confirmed
      const result1 = await gateway.execute(makeInput(), executeFn);
      expect(() => assertGatewayWriteSucceeded(result1)).not.toThrow();

      // Idempotent replay → also confirmed, also does not throw
      const result2 = await gateway.execute(makeInput(), executeFn);
      expect(result2.idempotent).toBe(true);
      expect(() => assertGatewayWriteSucceeded(result2)).not.toThrow();
    });
  });

  describe("direct CircleCliAdapter access", () => {
    it("gateway owns the Circle CLI calls — executeFn receives circle reference", async () => {
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());

      await gateway.execute(makeInput(), executeFn);

      // executeFn should have been called with the circle adapter and signal
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(executeFn).toHaveBeenCalledWith(circle, undefined);
    });
  });

  // ── Query ──────────────────────────────────────────────────────────

  describe("query operations", () => {
    it("getOperation returns the operation record", async () => {
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());
      const result = await gateway.execute(makeInput(), executeFn);

      const record = gateway.getOperation(result.operationId);
      expect(record).toBeDefined();
      expect(record!.state).toBe("confirmed");
      expect(record!.idempotencyKey).toBe("idem-key-1");
    });

    it("getOperationsByState returns operations in a given state", async () => {
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());
      await gateway.execute(makeInput(), executeFn);

      const confirmed = gateway.getOperationsByState("confirmed");
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].state).toBe("confirmed");

      const failed = gateway.getOperationsByState("failed");
      expect(failed).toHaveLength(0);
    });

    it("operationCount tracks total operations", async () => {
      expect(gateway.operationCount).toBe(0);

      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());
      await gateway.execute(makeInput(), executeFn);

      expect(gateway.operationCount).toBe(1);
    });
  });

  // ── AbortSignal ────────────────────────────────────────────────────

  describe("AbortSignal propagation", () => {
    it("passes signal to executeFn", async () => {
      const controller = new AbortController();
      const executeFn: CircleCliExecuteFn = vi.fn().mockResolvedValue(makeMockCircleCliResult());

      await gateway.execute(makeInput(), executeFn, controller.signal);

      expect(executeFn).toHaveBeenCalledWith(circle, controller.signal);
    });
  });
});
