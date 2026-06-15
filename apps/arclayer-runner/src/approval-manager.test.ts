/**
 * ApprovalManager tests.
 *
 * Tests the full approval lifecycle with mocked RunnerServices
 * to verify security checks, state transitions, and ExecutionGateway integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ApprovalManager } from "./approval-manager";
import { computeRequestHash } from "@arclayer/runner-core";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

// ── Mock RunnerServices ────────────────────────────────────────────────────

function createMockServices() {
  return {
    createJob: vi.fn().mockResolvedValue({ ok: true, txHash: "0xcreatejob", operationId: "op-create" }),
    approveUsdcForErc8183: vi.fn().mockResolvedValue({ ok: true, txHash: "0xapprove", operationId: "op-approve" }),
    fundJob: vi.fn().mockResolvedValue({ ok: true, txHash: "0xfund", operationId: "op-fund" }),
    claimRefund: vi.fn().mockResolvedValue({ ok: true, txHash: "0xrefund", operationId: "op-refund" }),
    config: { dataDir: "" },
  } as any;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const WALLET_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CHAIN_ID = 5042002;
const WRONG_CHAIN = 1;

function createJobParams(overrides?: Record<string, unknown>) {
  return {
    provider: "0x1111111111111111111111111111111111111111",
    evaluator: "0x2222222222222222222222222222222222222222",
    expiredAt: "9999999999",
    description: "test job",
    hook: "0x0000000000000000000000000000000000000000",
    ...overrides,
  };
}

function approveUsdcParams(overrides?: Record<string, unknown>) {
  return {
    amount: "5000000",
    ...overrides,
  };
}

/** Catch error and return it — avoids unhandled rejection warnings */
async function catchError(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
    expect.fail("should have thrown");
  } catch (e: any) {
    return e;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ApprovalManager", () => {
  let manager: ApprovalManager;
  let mockServices: ReturnType<typeof createMockServices>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "approval-mgr-test-"));
    mockServices = createMockServices();
    mockServices.config.dataDir = tmpDir;
    manager = new ApprovalManager(mockServices, tmpDir);
  });

  afterEach(() => {
    manager.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Create ───────────────────────────────────────────────────────────

  describe("createApproval", () => {
    it("creates a pending approval with correct fields", () => {
      const params = createJobParams();
      const result = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params,
      });

      expect(result.ok).toBe(true);
      expect(result.approvalId).toMatch(/^apr-/);
      expect(result.state).toBe("pending");
      expect(result.requestHash).toBe(computeRequestHash(params));
      expect(result.expiresAt).toBeDefined();
      expect(result.summary).toContain("createJob");
      expect(result.renderableMessage).toContain("Approval Required");
    });

    it("respects custom expiry", () => {
      const result = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
        expiresInSeconds: 600,
      });

      const expiresAt = new Date(result.expiresAt).getTime();
      const now = Date.now();
      // Should be ~600 seconds from now (within 5s tolerance)
      expect(expiresAt - now).toBeGreaterThan(595_000);
      expect(expiresAt - now).toBeLessThan(605_000);
    });

    it("caps expiry at 24 hours", () => {
      const result = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
        expiresInSeconds: 999999,
      });

      const expiresAt = new Date(result.expiresAt).getTime();
      const now = Date.now();
      // Should be capped at 86400 seconds (24 hours)
      expect(expiresAt - now).toBeLessThanOrEqual(86400_000 + 5000);
    });

    it("returns existing approval for duplicate idempotency key", () => {
      const key = `test-idem-${Date.now()}`;
      const result1 = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
        idempotencyKey: key,
      });
      const result2 = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
        idempotencyKey: key,
      });

      expect(result1.approvalId).toBe(result2.approvalId);
    });
  });

  // ── Approve → Execute ────────────────────────────────────────────────

  describe("approve", () => {
    it("executes createJob via services.createJob", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const result = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result.ok).toBe(true);
      expect(result.state).toBe("executed");
      expect(result.txHash).toBe("0xcreatejob");
      expect(mockServices.createJob).toHaveBeenCalledTimes(1);
    });

    it("executes approveUsdc via services.approveUsdcForErc8183", async () => {
      const created = manager.createApproval({
        actionType: "approveUsdc",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: approveUsdcParams(),
        amount: "5000000",
      });

      const result = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result.ok).toBe(true);
      expect(result.state).toBe("executed");
      expect(mockServices.approveUsdcForErc8183).toHaveBeenCalledTimes(1);
    });

    it("executes fundJob via services.fundJob", async () => {
      const created = manager.createApproval({
        actionType: "fundJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: { jobId: "12345" },
        jobId: "12345",
      });

      const result = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result.ok).toBe(true);
      expect(result.state).toBe("executed");
      expect(mockServices.fundJob).toHaveBeenCalledTimes(1);
    });

    it("executes claimRefund via services.claimRefund", async () => {
      const created = manager.createApproval({
        actionType: "claimRefund",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: { jobId: "99999" },
        jobId: "99999",
      });

      const result = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result.ok).toBe(true);
      expect(result.state).toBe("executed");
      expect(mockServices.claimRefund).toHaveBeenCalledTimes(1);
    });

    it("executes with correct chainId", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const result = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result.ok).toBe(true);
      expect(result.state).toBe("executed");
    });
  });

  // ── Duplicate approve behavior ───────────────────────────────────────

  describe("duplicate approve", () => {
    it("returns existing result after executed, no duplicate tx", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const result1 = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });
      const result2 = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result1.state).toBe("executed");
      expect(result2.state).toBe("executed");
      expect(result2.idempotent).toBe(true);
      // Only one actual execution
      expect(mockServices.createJob).toHaveBeenCalledTimes(1);
    });

    it("returns in-progress while executing, does not execute again", async () => {
      // Make createJob hang
      let resolveCreateJob: (v: unknown) => void;
      mockServices.createJob.mockReturnValue(
        new Promise((resolve) => { resolveCreateJob = resolve; })
      );

      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      // Start first approve (will hang)
      const promise1 = manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      // Wait a tick for the state to transition to executing
      await new Promise((r) => setTimeout(r, 10));

      // Second approve should see executing state
      const result2 = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result2.ok).toBe(false);
      expect(result2.state).toBe("executing");
      expect(result2.error).toContain("currently being executed");

      // Resolve the hanging promise
      resolveCreateJob!({ ok: true, txHash: "0xdelayed" });
      await promise1;

      // createJob should have been called only once
      expect(mockServices.createJob).toHaveBeenCalledTimes(1);
    });
  });

  // ── Security checks ─────────────────────────────────────────────────

  describe("security checks", () => {
    it("approve blocks wrong role", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const e = await catchError(() =>
        manager.approve({
          approvalId: created.approvalId,
          walletAddress: WALLET_A,
          role: "provider",
          chainId: CHAIN_ID,
        })
      );
      expect(e.code).toBe("ROLE_MISMATCH");
    });

    it("approve blocks wrong wallet", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const e = await catchError(() =>
        manager.approve({
          approvalId: created.approvalId,
          walletAddress: WALLET_B,
          role: "client",
          chainId: CHAIN_ID,
        })
      );
      expect(e.code).toBe("WALLET_MISMATCH");
    });

    it("approve blocks wrong chain", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const e = await catchError(() =>
        manager.approve({
          approvalId: created.approvalId,
          walletAddress: WALLET_A,
          role: "client",
          chainId: WRONG_CHAIN,
        })
      );
      expect(e.code).toBe("CHAIN_MISMATCH");
    });

    it("approve blocks expectedRequestHash mismatch", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const e = await catchError(() =>
        manager.approve({
          approvalId: created.approvalId,
          walletAddress: WALLET_A,
          role: "client",
          chainId: CHAIN_ID,
          expectedRequestHash: "0000000000000000000000000000000000000000000000000000000000000000",
        })
      );
      expect(e.code).toBe("REQUEST_HASH_MISMATCH");
    });

    it("approve blocks rejected approval", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      manager.reject({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
      });

      const e = await catchError(() =>
        manager.approve({
          approvalId: created.approvalId,
          walletAddress: WALLET_A,
          role: "client",
          chainId: CHAIN_ID,
        })
      );
      expect(e.code).toBe("APPROVAL_REJECTED");
    });

    it("approve blocks cancelled approval", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      manager.cancel({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
      });

      const e = await catchError(() =>
        manager.approve({
          approvalId: created.approvalId,
          walletAddress: WALLET_A,
          role: "client",
          chainId: CHAIN_ID,
        })
      );
      expect(e.code).toBe("APPROVAL_CANCELLED");
    });

    it("approve blocks expired approval", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
        expiresInSeconds: 60,
      });

      // Directly manipulate the DB to set expiresAt in the past
      (manager.store as any).db.prepare(
        "UPDATE approvals SET expires_at = '2020-01-01T00:00:00.000Z' WHERE approval_id = ?"
      ).run(created.approvalId);

      const e = await catchError(() =>
        manager.approve({
          approvalId: created.approvalId,
          walletAddress: WALLET_A,
          role: "client",
          chainId: CHAIN_ID,
        })
      );
      expect(e.code).toBe("APPROVAL_EXPIRED");
    });

    it("reject blocks wrong role", () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      try {
        manager.reject({
          approvalId: created.approvalId,
          walletAddress: WALLET_A,
          role: "provider",
        });
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("ROLE_MISMATCH");
      }
    });

    it("cancel blocks wrong role", () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      try {
        manager.cancel({
          approvalId: created.approvalId,
          walletAddress: WALLET_A,
          role: "provider",
        });
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("ROLE_MISMATCH");
      }
    });

    it("getApproval blocks wrong role", () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      try {
        manager.getApproval(created.approvalId, WALLET_A, "provider");
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("ROLE_MISMATCH");
      }
    });

    it("getApproval blocks wrong wallet", () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      try {
        manager.getApproval(created.approvalId, WALLET_B, "client");
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("WALLET_MISMATCH");
      }
    });

    it("listPending requires walletAddress", () => {
      try {
        manager.listPending("" as any);
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("INVALID_WALLET");
      }
    });
  });

  // ── Execution failure ────────────────────────────────────────────────

  describe("execution failure", () => {
    it("transitions to failed when service method throws", async () => {
      mockServices.createJob.mockRejectedValue(new Error("Circle CLI timeout"));

      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const result = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result.ok).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.error).toContain("Circle CLI timeout");

      // Verify stored state
      const stored = manager.store.get(created.approvalId);
      expect(stored!.state).toBe("failed");
    });

    it("does not auto-retry failed approvals", async () => {
      mockServices.createJob.mockRejectedValue(new Error("timeout"));

      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      // Try again — should return failed state, not retry
      const result2 = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result2.ok).toBe(false);
      expect(result2.state).toBe("failed");
      expect(mockServices.createJob).toHaveBeenCalledTimes(1); // no retry
    });

    it("transitions to failed when service returns ok:false", async () => {
      mockServices.createJob.mockResolvedValue({
        ok: false,
        mode: "prepared-only",
        reason: "CIRCLE_WALLET_ADDRESS not configured",
      });

      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const result = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result.ok).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.error).toContain("CIRCLE_WALLET_ADDRESS");

      const stored = manager.store.get(created.approvalId);
      expect(stored!.state).toBe("failed");
    });

    it("rejects invalid params before executing", async () => {
      const created = manager.createApproval({
        actionType: "approveUsdc",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: { amount: "not-a-number" },
      });

      const result = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      expect(result.ok).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.error).toContain("Approval params failed approveUsdc schema");

      // Service should NOT have been called
      expect(mockServices.approveUsdcForErc8183).not.toHaveBeenCalled();
    });
  });

  // ── Reject / Cancel ─────────────────────────────────────────────────

  describe("reject", () => {
    it("rejects a pending approval", () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const result = manager.reject({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        reason: "not needed",
      });

      expect(result.ok).toBe(true);
      expect(result.state).toBe("rejected");
    });

    it("blocks rejecting non-pending approval", () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      manager.reject({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
      });

      const result = manager.reject({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("INVALID_STATE");
    });
  });

  describe("cancel", () => {
    it("cancels a pending approval", () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const result = manager.cancel({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
      });

      expect(result.ok).toBe(true);
      expect(result.state).toBe("cancelled");
    });

    it("blocks cancelling executing approval", async () => {
      // Make createJob hang
      mockServices.createJob.mockReturnValue(new Promise(() => {}));

      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      // Start approve (will hang in executing)
      manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });

      // Wait for state transition
      await new Promise((r) => setTimeout(r, 10));

      const result = manager.cancel({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("INVALID_STATE");
    });
  });

  // ── List Pending ─────────────────────────────────────────────────────

  describe("listPending", () => {
    it("lists pending approvals for a wallet", () => {
      manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });
      manager.createApproval({
        actionType: "approveUsdc",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: approveUsdcParams(),
        amount: "5000000",
      });

      const pending = manager.listPending(WALLET_A);
      expect(pending.length).toBeGreaterThanOrEqual(2);
      expect(pending.every((r) => r.state === "pending")).toBe(true);
    });

    it("excludes non-pending approvals", () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      manager.reject({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
      });

      const pending = manager.listPending(WALLET_A);
      expect(pending.find((r) => r.approvalId === created.approvalId)).toBeUndefined();
    });

    it("returns only approvals for the specified wallet", () => {
      manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });
      manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_B,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const pendingA = manager.listPending(WALLET_A);
      expect(pendingA.every((r) => r.walletAddress === WALLET_A)).toBe(true);
    });
  });

  // ── No Telegram refs ────────────────────────────────────────────────

  describe("no Telegram refs", () => {
    it("renderable message contains no Telegram-specific code", () => {
      const result = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const msg = result.renderableMessage.toLowerCase();
      expect(msg).not.toContain("telegram");
      expect(msg).not.toContain("bot_token");
      expect(msg).not.toContain("chat_id");
    });
  });
});
