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
    registerErc8004WithApproval: vi.fn().mockResolvedValue({
      ok: true, txHash: "0xerc8004", tokenId: "12345", agentId: "12345", agentVisible: true, role: "provider",
    }),
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
async function catchError(fn: () => unknown): Promise<any> {
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

    it("rejects invalid params at create time", async () => {
      // With fix #1, params are validated at create time, not approve time
      const e = await catchError(() =>
        manager.createApproval({
          actionType: "approveUsdc",
          walletAddress: WALLET_A,
          chainId: CHAIN_ID,
          params: { amount: "not-a-number" },
        })
      );
      expect(e.code).toBe("INVALID_PARAMS");
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

  // ── Fix #1: Display fields from validated params ─────────────────────

  describe("display fields from validated params", () => {
    it("rejects conflicting top-level amount for approveUsdc", async () => {
      const e = await catchError(() =>
        manager.createApproval({
          actionType: "approveUsdc",
          walletAddress: WALLET_A,
          chainId: CHAIN_ID,
          amount: "999999", // conflicts with params
          params: { amount: "5000000" },
        })
      );
      expect(e.code).toBe("DISPLAY_PARAMS_MISMATCH");
    });

    it("rejects conflicting top-level jobId for fundJob", async () => {
      const e = await catchError(() =>
        manager.createApproval({
          actionType: "fundJob",
          walletAddress: WALLET_A,
          chainId: CHAIN_ID,
          jobId: "11111", // conflicts with params
          params: { jobId: "12345" },
        })
      );
      expect(e.code).toBe("DISPLAY_PARAMS_MISMATCH");
    });

    it("creates with matching derived fields", () => {
      const result = manager.createApproval({
        actionType: "approveUsdc",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        amount: "5000000", // matches params
        params: { amount: "5000000" },
      });
      expect(result.ok).toBe(true);
      expect(result.approvalId).toMatch(/^apr-/);

      // Verify stored values
      const stored = manager.store.get(result.approvalId);
      expect(stored!.amount).toBe("5000000");
    });

    it("derives jobId from params for fundJob when not supplied", () => {
      const result = manager.createApproval({
        actionType: "fundJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: { jobId: "12345" },
      });
      expect(result.ok).toBe(true);
      const stored = manager.store.get(result.approvalId);
      expect(stored!.jobId).toBe("12345");
    });
  });

  // ── Fix #2: Configured chain validation ─────────────────────────────

  describe("configured chain validation", () => {
    it("blocks approval with wrong configured chain", async () => {
      const chainManager = new ApprovalManager(mockServices, tmpDir, CHAIN_ID);

      // Create approval on the WRONG_CHAIN
      const created = chainManager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: WRONG_CHAIN,
        params: createJobParams(),
      });

      const e = await catchError(() =>
        chainManager.approve({
          approvalId: created.approvalId,
          walletAddress: WALLET_A,
          role: "client",
          chainId: WRONG_CHAIN,
        })
      );
      expect(e.code).toBe("CHAIN_MISMATCH");
      expect(e.message).toContain("configured chain");
    });

    it("allows approval with matching configured chain", async () => {
      const chainManager = new ApprovalManager(mockServices, tmpDir, CHAIN_ID);

      const created = chainManager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const result = await chainManager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
      });
      expect(result.ok).toBe(true);
      expect(result.state).toBe("executed");
    });
  });

  // ── Fix #3: Configured signer wallet validation ─────────────────────

  describe("configured signer wallet validation", () => {
    it("blocks create with wrong signer wallet", async () => {
      const walletManager = new ApprovalManager(mockServices, tmpDir, undefined, WALLET_A);

      const e = await catchError(() =>
        walletManager.createApproval({
          actionType: "createJob",
          walletAddress: WALLET_B,
          chainId: CHAIN_ID,
          params: createJobParams(),
        })
      );
      expect(e.code).toBe("SIGNER_WALLET_MISMATCH");
    });

    it("allows create with matching signer wallet", () => {
      const walletManager = new ApprovalManager(mockServices, tmpDir, undefined, WALLET_A);

      const result = walletManager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });
      expect(result.ok).toBe(true);
    });

    it("normalizes case for wallet comparison", () => {
      const walletManager = new ApprovalManager(
        mockServices, tmpDir, undefined,
        WALLET_A.toUpperCase()
      );

      const result = walletManager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });
      expect(result.ok).toBe(true);
    });
  });

  // ── Fix #4: AbortSignal propagation ─────────────────────────────────

  describe("abort signal propagation", () => {
    it("aborts execution when signal is already aborted", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });

      const controller = new AbortController();
      controller.abort();

      const result = await manager.approve({
        approvalId: created.approvalId,
        walletAddress: WALLET_A,
        role: "client",
        chainId: CHAIN_ID,
        signal: controller.signal,
      });

      expect(result.ok).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.error).toContain("aborted");
    });
  });

  // ── Fix #5: Idempotency conflict validation ─────────────────────────

  describe("idempotency conflict validation", () => {
    it("rejects idempotency conflict with different wallet", async () => {
      const key = `test-idem-conflict-${Date.now()}`;

      manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
        idempotencyKey: key,
      });

      const e = await catchError(() =>
        manager.createApproval({
          actionType: "createJob",
          walletAddress: WALLET_B,
          chainId: CHAIN_ID,
          params: createJobParams(),
          idempotencyKey: key,
        })
      );
      expect(e.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    });

    it("rejects idempotency conflict with different actionType", async () => {
      const key = `test-idem-action-${Date.now()}`;

      manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
        idempotencyKey: key,
      });

      const e = await catchError(() =>
        manager.createApproval({
          actionType: "approveUsdc",
          walletAddress: WALLET_A,
          chainId: CHAIN_ID,
          params: { amount: "1000" },
          idempotencyKey: key,
        })
      );
      expect(e.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    });

    it("rejects idempotency conflict with different chainId", async () => {
      const key = `test-idem-chain-${Date.now()}`;

      manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
        idempotencyKey: key,
      });

      const e = await catchError(() =>
        manager.createApproval({
          actionType: "createJob",
          walletAddress: WALLET_A,
          chainId: WRONG_CHAIN,
          params: createJobParams(),
          idempotencyKey: key,
        })
      );
      expect(e.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    });

    it("allows idempotency replay with same metadata", () => {
      const key = `test-idem-replay-${Date.now()}`;
      const params = createJobParams();

      const result1 = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params,
        idempotencyKey: key,
      });

      const result2 = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params,
        idempotencyKey: key,
      });

      expect(result1.approvalId).toBe(result2.approvalId);
      expect(result2.ok).toBe(true);
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

  // ── ERC-8004 Registration ────────────────────────────────────────────

  function erc8004Params(overrides?: Record<string, unknown>) {
    return {
      controllerAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ownerAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      agentName: "test-agent",
      role: "provider",
      metadataURI: "https://example.com/metadata.json",
      metadataJson: { name: "test-agent", roles: ["provider"] },
      ...overrides,
    };
  }

  describe("executeErc8004Registration", () => {
    it("rejects execution of non-erc8004 approval", async () => {
      const created = manager.createApproval({
        actionType: "createJob",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: createJobParams(),
      });
      manager.approveById(created.approvalId);

      const result = await manager.executeErc8004Registration(created.approvalId);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("INVALID_APPROVAL_ACTION_TYPE");
    });

    it("rejects execution when state is not approved", async () => {
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });

      // Still pending — not approved yet
      const result = await manager.executeErc8004Registration(created.approvalId);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("requires approved");
    });

    it("executes successfully after approval", async () => {
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      const result = await manager.executeErc8004Registration(created.approvalId);
      expect(result.ok).toBe(true);
      expect(result.state).toBe("executed");
      expect(result.txHash).toBe("0xerc8004");
      expect(result.agentVisible).toBe(true);
    });

    it("returns idempotent result when already executed", async () => {
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      await manager.executeErc8004Registration(created.approvalId);
      const result2 = await manager.executeErc8004Registration(created.approvalId);
      expect(result2.ok).toBe(true);
      expect(result2.idempotent).toBe(true);
      expect(mockServices.registerErc8004WithApproval).toHaveBeenCalledTimes(1);
    });

    it("transitions to failed when service returns ok:false", async () => {
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, errorCode: "onchain_failed", reason: "Circle CLI error",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      const result = await manager.executeErc8004Registration(created.approvalId);
      expect(result.ok).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.errorCode).toBe("onchain_failed");
    });

    it("returns no_console_url when service reports missing consoleUrl", async () => {
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, agentVisible: false, errorCode: "no_console_url",
        reason: "ARCLAYER_CONSOLE_URL/consoleUrl is required before submitting ERC-8004 registration",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      const result = await manager.executeErc8004Registration(created.approvalId);
      expect(result.ok).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.errorCode).toBe("no_console_url");
      // Circle CLI should NOT have been called (service returned early)
      expect(result.txHash).toBeUndefined();
    });

    it("returns sync_secret_not_configured when service reports missing syncSecret", async () => {
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, agentVisible: false, errorCode: "sync_secret_not_configured",
        reason: "ARCLAYER_RUNNER_SYNC_SECRET is required before submitting ERC-8004 registration",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      const result = await manager.executeErc8004Registration(created.approvalId);
      expect(result.ok).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.errorCode).toBe("sync_secret_not_configured");
      expect(result.txHash).toBeUndefined();
    });

    it("returns sync_pending_retryable and stays executing when sync returns 425", async () => {
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xretryable", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "Tx submitted but dashboard sync pending",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      const result = await manager.executeErc8004Registration(created.approvalId);
      expect(result.ok).toBe(false);
      expect(result.state).toBe("executing");
      expect(result.errorCode).toBe("sync_pending_retryable");
      expect(result.retryable).toBe(true);
      expect(result.txHash).toBe("0xretryable");

      // Should NOT be failed_persistence
      expect(result.errorCode).not.toBe("failed_persistence");
    });

    it("allows retry from executing state with stored txHash (no duplicate on-chain tx)", async () => {
      // First attempt: sync returns 425 retryable
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xretrytx", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "Tx submitted but dashboard sync pending",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      const result1 = await manager.executeErc8004Registration(created.approvalId);
      expect(result1.state).toBe("executing");
      expect(result1.txHash).toBe("0xretrytx");

      // Second attempt: sync succeeds
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: true, txHash: "0xretrytx", tokenId: "99999", agentId: "99999",
        agentVisible: true, role: "provider",
      });

      const result2 = await manager.executeErc8004Registration(created.approvalId);
      expect(result2.ok).toBe(true);
      expect(result2.state).toBe("executed");
      expect(result2.txHash).toBe("0xretrytx");

      // Verify: service was called twice (first + retry)
      expect(mockServices.registerErc8004WithApproval).toHaveBeenCalledTimes(2);

      // Verify: second call had skipOnChainTxHash (no duplicate on-chain tx)
      const secondCallParams = mockServices.registerErc8004WithApproval.mock.calls[1][0];
      expect(secondCallParams.skipOnChainTxHash).toBe("0xretrytx");
    });

    it("retry from executing stays executing if still 425", async () => {
      // First: 425
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xstillpending", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "Still not mined",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);
      await manager.executeErc8004Registration(created.approvalId);

      // Second: still 425
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xstillpending", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "Still not mined",
      });

      const result2 = await manager.executeErc8004Registration(created.approvalId);
      expect(result2.ok).toBe(false);
      expect(result2.state).toBe("executing");
      expect(result2.retryable).toBe(true);

      // Verify: still not called Circle CLI again (skipOnChainTxHash)
      const secondCallParams = mockServices.registerErc8004WithApproval.mock.calls[1][0];
      expect(secondCallParams.skipOnChainTxHash).toBe("0xstillpending");
    });

    it("retry from executing transitions to failed on non-retryable error", async () => {
      // First: 425 retryable
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xwillfail", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "Not mined yet",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);
      await manager.executeErc8004Registration(created.approvalId);

      // Second: non-retryable failure
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xwillfail", agentVisible: false,
        errorCode: "failed_persistence",
        reason: "Supabase upsert failed",
      });

      const result2 = await manager.executeErc8004Registration(created.approvalId);
      expect(result2.ok).toBe(false);
      expect(result2.state).toBe("failed");
      expect(result2.errorCode).toBe("failed_persistence");
    });

    it("concurrent execution is still blocked for non-retryable executing approvals", async () => {
      // Manually put approval in executing state without retryable metadata
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      // Start a slow execution
      let resolveExec: (v: any) => void;
      mockServices.registerErc8004WithApproval.mockReturnValueOnce(
        new Promise((resolve) => { resolveExec = resolve; })
      );

      const execPromise = manager.executeErc8004Registration(created.approvalId);

      // Concurrent call should be blocked
      const concurrent = await manager.executeErc8004Registration(created.approvalId);
      expect(concurrent.ok).toBe(false);
      expect(concurrent.error).toContain("currently being executed");

      // Resolve the hanging promise
      resolveExec!({ ok: true, txHash: "0xdelayed", tokenId: "1", agentId: "1", agentVisible: true });
      await execPromise;
    });
  });

  describe("approveAndExecuteErc8004", () => {
    it("approves and executes in one call", async () => {
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });

      const result = await manager.approveAndExecuteErc8004(created.approvalId);
      expect(result.ok).toBe(true);
      expect(result.state).toBe("executed");
    });

    it("returns idempotent when already executed", async () => {
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });

      await manager.approveAndExecuteErc8004(created.approvalId);
      const result2 = await manager.approveAndExecuteErc8004(created.approvalId);
      expect(result2.ok).toBe(true);
      expect(result2.idempotent).toBe(true);
    });

    it("allows retry via approveAndExecute when executing with retryable metadata", async () => {
      // First: 425
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xcombo_retry", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "Not mined",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);
      await manager.executeErc8004Registration(created.approvalId);

      // Retry via approveAndExecute
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: true, txHash: "0xcombo_retry", tokenId: "88888", agentId: "88888",
        agentVisible: true, role: "provider",
      });

      const retryResult = await manager.approveAndExecuteErc8004(created.approvalId);
      expect(retryResult.ok).toBe(true);
      expect(retryResult.state).toBe("executed");
      expect(retryResult.txHash).toBe("0xcombo_retry");
    });
  });

  // ── Dedup beyond pending (Fix 2) ────────────────────────────────────────

  describe("findExistingByErc8004Signature", () => {
    it("blocks duplicate pending approval", () => {
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });

      const existing = manager.findExistingByErc8004Signature(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://example.com/metadata.json",
        "provider",
      );
      expect(existing).toBeDefined();
      expect(existing!.approvalId).toBe(created.approvalId);
      expect(existing!.state).toBe("pending");
    });

    it("blocks duplicate approved approval", () => {
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      const existing = manager.findExistingByErc8004Signature(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://example.com/metadata.json",
        "provider",
      );
      expect(existing).toBeDefined();
      expect(existing!.approvalId).toBe(created.approvalId);
      expect(existing!.state).toBe("approved");
    });

    it("blocks duplicate executing approval", async () => {
      // Slow execution to keep in executing state
      let resolveExec: (v: any) => void;
      mockServices.registerErc8004WithApproval.mockReturnValueOnce(
        new Promise((resolve) => { resolveExec = resolve; })
      );

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      // Start execution (don't await yet)
      const execPromise = manager.executeErc8004Registration(created.approvalId);

      const existing = manager.findExistingByErc8004Signature(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://example.com/metadata.json",
        "provider",
      );
      expect(existing).toBeDefined();
      expect(existing!.approvalId).toBe(created.approvalId);
      expect(existing!.state).toBe("executing");

      // Cleanup
      resolveExec!({ ok: true, txHash: "0xdup", tokenId: "1", agentId: "1", agentVisible: true });
      await execPromise;
    });

    it("returns executed approval for idempotent lookup", async () => {
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);
      await manager.executeErc8004Registration(created.approvalId);

      const existing = manager.findExistingByErc8004Signature(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://example.com/metadata.json",
        "provider",
      );
      expect(existing).toBeDefined();
      expect(existing!.approvalId).toBe(created.approvalId);
      expect(existing!.state).toBe("executed");
      expect(existing!.txHash).toBe("0xerc8004");
    });

    it("does not block on failed approval — allows new creation", () => {
      // Create an approval and put it through to failed via proper state flow
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);
      // Must be in executing state before transitionToFailed (WHERE state = 'executing')
      manager.store.transitionFromApprovedToExecuting(created.approvalId);
      manager.store.transitionToFailed(created.approvalId, "test failure");

      const existing = manager.findExistingByErc8004Signature(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://example.com/metadata.json",
        "provider",
      );
      expect(existing).toBeUndefined();
    });

    it("does not block on rejected approval — allows new creation", () => {
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.reject({ approvalId: created.approvalId, walletAddress: WALLET_A, role: "client" });

      const existing = manager.findExistingByErc8004Signature(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "https://example.com/metadata.json",
        "provider",
      );
      expect(existing).toBeUndefined();
    });
  });

  // ── txHash preservation on persistence failure (Fix 5) ──────────────────

  describe("txHash preservation on failed_persistence", () => {
    it("preserves txHash when service returns ok:false + txHash + failed_persistence", async () => {
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xfailedpersist", agentVisible: false,
        errorCode: "failed_persistence",
        reason: "Supabase upsert failed",
        tokenId: "99999", agentId: "99999",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      const result = await manager.executeErc8004Registration(created.approvalId);
      expect(result.ok).toBe(false);
      expect(result.state).toBe("failed");
      expect(result.errorCode).toBe("failed_persistence");

      // Verify the approval record preserves txHash
      const record = manager.store.get(created.approvalId)!;
      expect(record.state).toBe("failed");
      expect(record.txHash).toBe("0xfailedpersist");

      // Verify resultJson contains txHash and errorCode
      const resultJson = JSON.parse(record.resultJson!);
      expect(resultJson.txHash).toBe("0xfailedpersist");
      expect(resultJson.errorCode).toBe("failed_persistence");
    });

    it("preserves txHash on retry path non-retryable failure", async () => {
      // First: 425 retryable
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xretryfail", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "Not mined yet",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);
      await manager.executeErc8004Registration(created.approvalId);

      // Second: non-retryable failed_persistence
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xretryfail", agentVisible: false,
        errorCode: "failed_persistence",
        reason: "Console sync failed permanently",
        tokenId: "88888", agentId: "88888",
      });

      const result2 = await manager.executeErc8004Registration(created.approvalId);
      expect(result2.ok).toBe(false);
      expect(result2.state).toBe("failed");
      expect(result2.errorCode).toBe("failed_persistence");

      // Verify the approval record preserves txHash
      const record = manager.store.get(created.approvalId)!;
      expect(record.state).toBe("failed");
      expect(record.txHash).toBe("0xretryfail");
      expect(record.resultJson).toBeTruthy();
      const resultJson = JSON.parse(record.resultJson!);
      expect(resultJson.txHash).toBe("0xretryfail");
      expect(resultJson.errorCode).toBe("failed_persistence");
    });
  });

  // ── Fix: sync_pending_retryable stays executing (network error after tx) ──

  describe("sync exception retryable (P1 fix)", () => {
    it("returns sync_pending_retryable when sync fetch throws after tx submitted", async () => {
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xsyncex", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "On-chain tx submitted (0xsyncex) but console sync call failed transiently",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      const result = await manager.executeErc8004Registration(created.approvalId);
      expect(result.ok).toBe(false);
      expect(result.state).toBe("executing");
      expect(result.errorCode).toBe("sync_pending_retryable");
      expect(result.retryable).toBe(true);
      expect(result.txHash).toBe("0xsyncex");

      // Should NOT be failed — stays executing for retry
      const stored = manager.store.get(created.approvalId)!;
      expect(stored.state).toBe("executing");
    });

    it("stays executing on retry path when sync exception is still retryable", async () => {
      // First: 425
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xsyncret", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "Not mined yet",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);
      await manager.executeErc8004Registration(created.approvalId);

      // Retry: sync exception returns retryable
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xsyncret", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "On-chain tx submitted (0xsyncret) but console sync call failed transiently",
      });

      const result2 = await manager.executeErc8004Registration(created.approvalId);
      expect(result2.ok).toBe(false);
      expect(result2.state).toBe("executing");
      expect(result2.retryable).toBe(true);

      const stored = manager.store.get(created.approvalId)!;
      expect(stored.state).toBe("executing");
    });
  });

  // ── Fix: approvalId injection into service params ─────────────────────────

  describe("approvalId injection into service params", () => {
    it("injects approvalId into service params on execute", async () => {
      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);

      await manager.executeErc8004Registration(created.approvalId);

      // Check that registerErc8004WithApproval was called with params containing approvalId
      const callParams = mockServices.registerErc8004WithApproval.mock.calls[0][0];
      expect(callParams.approvalId).toBe(created.approvalId);
    });

    it("injects approvalId into retry params", async () => {
      // First: 425 retryable
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: false, txHash: "0xinjectretry", agentVisible: false,
        errorCode: "sync_pending_retryable", retryable: true,
        reason: "Not mined yet",
      });

      const created = manager.createApproval({
        actionType: "erc8004_register_agent",
        walletAddress: WALLET_A,
        chainId: CHAIN_ID,
        params: erc8004Params(),
      });
      manager.approveById(created.approvalId);
      await manager.executeErc8004Registration(created.approvalId);

      // Retry
      mockServices.registerErc8004WithApproval.mockResolvedValueOnce({
        ok: true, txHash: "0xinjectretry", tokenId: "77777", agentId: "77777",
        agentVisible: true, role: "provider",
      });

      await manager.executeErc8004Registration(created.approvalId);

      // Check retry call also had approvalId
      const retryParams = mockServices.registerErc8004WithApproval.mock.calls[1][0];
      expect(retryParams.approvalId).toBe(created.approvalId);
      expect(retryParams.skipOnChainTxHash).toBe("0xinjectretry");
    });
  });
});
