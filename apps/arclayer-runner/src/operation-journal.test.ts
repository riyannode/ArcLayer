import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OperationJournal } from "./operation-journal";
import type { OperationRecord } from "@arclayer/runner-core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { unlinkSync, existsSync } from "node:fs";

// ── Helpers ────────────────────────────────────────────────────────────

function tmpDbPath(): string {
  return join(tmpdir(), `op-journal-test-${randomUUID()}.db`);
}

function cleanupDb(dbPath: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
  }
}

function makeRecord(overrides: Partial<OperationRecord> = {}): OperationRecord {
  const id = `op-${randomUUID()}`;
  const now = new Date().toISOString();
  return {
    operationId: id,
    idempotencyKey: `idem-${randomUUID()}`,
    toolName: "createJob",
    agentId: "agent-1",
    walletAddress: "0x3c46624b62fa4cf3d63e6bdd60dc1b79a43ceb22",
    chainId: 5042002,
    contractAddress: "0x0747EEf0706327138c69792bF28Cd525089e4583",
    paramsHash: "0x" + "b".repeat(64),
    state: "created",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("OperationJournal", () => {
  let dbPath: string;
  let journal: OperationJournal;

  beforeEach(() => {
    dbPath = tmpDbPath();
    journal = new OperationJournal(dbPath);
  });

  afterEach(() => {
    journal.close();
    cleanupDb(dbPath);
  });

  // ── Schema Migrations ────────────────────────────────────────────────

  describe("schema migrations", () => {
    it("creates all tables on first open", () => {
      expect(journal.getSchemaVersion()).toBe(1);
    });

    it("migrations are idempotent", () => {
      journal.close();
      const journal2 = new OperationJournal(dbPath);
      expect(journal2.getSchemaVersion()).toBe(1);
      journal2.close();
    });

    it("persists schema version across restarts", () => {
      journal.close();
      const journal2 = new OperationJournal(dbPath);
      expect(journal2.getSchemaVersion()).toBe(1);
      journal2.close();
    });
  });

  // ── createOperationWithLocks ─────────────────────────────────────────

  describe("createOperationWithLocks", () => {
    it("creates operation + idempotency key + wallet lock atomically", () => {
      const record = makeRecord();
      const result = journal.createOperationWithLocks(record, { walletAddress: "0xABC" });

      expect(result.ok).toBe(true);
      expect(journal.getOperation(record.operationId)).toBeDefined();
      expect(journal.hasWalletLock("0xABC")).toBe(true);
    });

    it("creates operation + job lock atomically", () => {
      const record = makeRecord();
      const result = journal.createOperationWithLocks(record, { jobId: "job-42" });

      expect(result.ok).toBe(true);
      expect(journal.hasJobLock("job-42")).toBe(true);
    });

    it("returns IDEMPOTENCY_KEY_EXISTS for same key+params", () => {
      const record = makeRecord({ idempotencyKey: "key-1", paramsHash: "0x" + "a".repeat(64) });
      journal.createOperationWithLocks(record, {});

      const record2 = makeRecord({ idempotencyKey: "key-1", paramsHash: "0x" + "a".repeat(64) });
      const result = journal.createOperationWithLocks(record2, {});

      expect(result.ok).toBe(false);
      expect((result as any).error).toBe("IDEMPOTENCY_KEY_EXISTS");
    });

    it("returns IDEMPOTENCY_CONFLICT for same key + different params", () => {
      const record = makeRecord({ idempotencyKey: "key-1", paramsHash: "0x" + "a".repeat(64) });
      journal.createOperationWithLocks(record, {});

      const record2 = makeRecord({ idempotencyKey: "key-1", paramsHash: "0x" + "c".repeat(64) });
      const result = journal.createOperationWithLocks(record2, {});

      expect(result.ok).toBe(false);
      expect((result as any).error).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("returns WALLET_LOCKED when wallet is held", () => {
      const r1 = makeRecord();
      journal.createOperationWithLocks(r1, { walletAddress: "0xABC" });

      const r2 = makeRecord();
      const result = journal.createOperationWithLocks(r2, { walletAddress: "0xABC" });

      expect(result.ok).toBe(false);
      expect((result as any).error).toBe("WALLET_LOCKED");
    });

    it("returns JOB_LOCKED when job is held", () => {
      const r1 = makeRecord();
      journal.createOperationWithLocks(r1, { jobId: "job-42" });

      const r2 = makeRecord();
      const result = journal.createOperationWithLocks(r2, { jobId: "job-42" });

      expect(result.ok).toBe(false);
      expect((result as any).error).toBe("JOB_LOCKED");
    });

    it("lock conflict leaves no operation row", () => {
      const r1 = makeRecord();
      journal.createOperationWithLocks(r1, { walletAddress: "0xLOCKED" });

      const countBefore = journal.getOperationCount();
      const r2 = makeRecord();
      journal.createOperationWithLocks(r2, { walletAddress: "0xLOCKED" });
      const countAfter = journal.getOperationCount();

      expect(countAfter).toBe(countBefore); // no new operation created
    });

    it("lock conflict leaves no idempotency row", () => {
      const r1 = makeRecord();
      journal.createOperationWithLocks(r1, { walletAddress: "0xLOCKED" });

      const r2 = makeRecord({ idempotencyKey: "unique-key-for-r2" });
      journal.createOperationWithLocks(r2, { walletAddress: "0xLOCKED" });

      // r2's idempotency key should not exist in the journal
      const found = journal.getOperationsByState("created");
      const foundR2 = found.find(r => r.idempotency_key === "unique-key-for-r2");
      expect(foundR2).toBeUndefined();
    });

    it("wallet lock is case-insensitive", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, { walletAddress: "0xABC" });

      expect(journal.hasWalletLock("0xabc")).toBe(true);
      expect(journal.hasWalletLock("0xABC")).toBe(true);
    });

    it("different wallets do not conflict", () => {
      const r1 = makeRecord();
      journal.createOperationWithLocks(r1, { walletAddress: "0xAAA" });

      const r2 = makeRecord();
      const result = journal.createOperationWithLocks(r2, { walletAddress: "0xBBB" });
      expect(result.ok).toBe(true);
    });

    it("different jobIds do not conflict", () => {
      const r1 = makeRecord();
      journal.createOperationWithLocks(r1, { jobId: "job-1" });

      const r2 = makeRecord();
      const result = journal.createOperationWithLocks(r2, { jobId: "job-2" });
      expect(result.ok).toBe(true);
    });
  });

  // ── finalizeOperation ────────────────────────────────────────────────

  describe("finalizeOperation", () => {
    it("atomically stores state + txHash + result + releases locks", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, { walletAddress: "0xFINAL", jobId: "job-f" });

      journal.finalizeOperation(r.operationId, {
        state: "confirmed",
        txHash: "0x" + "a".repeat(64),
        result: { stdout: '{"ok":true}', json: { ok: true } },
      });

      const op = journal.getOperation(r.operationId);
      expect(op!.state).toBe("confirmed");
      expect(op!.tx_hash).toBe("0x" + "a".repeat(64));

      const result = journal.getResult(r.operationId);
      expect(result!.stdout).toBe('{"ok":true}');

      expect(journal.hasWalletLock("0xFINAL")).toBe(false);
      expect(journal.hasJobLock("job-f")).toBe(false);
    });

    it("stores receipt metadata atomically", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, {});

      journal.finalizeOperation(r.operationId, {
        state: "confirmed",
        receipt: { receiptId: "r-1", receiptHash: "0xabc", proofKind: "erc8183" },
      });

      const receipt = journal.getReceipt(r.operationId);
      expect(receipt!.receipt_id).toBe("r-1");
      expect(receipt!.proof_kind).toBe("erc8183");
    });

    it("releases locks on failed", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, { walletAddress: "0xFAIL", jobId: "job-fail" });

      journal.finalizeOperation(r.operationId, {
        state: "failed",
        errorCode: "BROADCAST_FAILED",
        errorMessage: "test",
      });

      expect(journal.hasWalletLock("0xFAIL")).toBe(false);
      expect(journal.hasJobLock("job-fail")).toBe(false);
    });

    it("releases locks on cancelled", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, { walletAddress: "0xCANCEL" });

      journal.finalizeOperation(r.operationId, { state: "cancelled" });

      expect(journal.hasWalletLock("0xCANCEL")).toBe(false);
    });

    it("confirmed finalization survives restart", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, {});

      journal.finalizeOperation(r.operationId, {
        state: "confirmed",
        txHash: "0x" + "a".repeat(64),
        result: { stdout: "persisted", json: { ok: true } },
      });

      journal.close();
      journal = new OperationJournal(dbPath);

      const op = journal.getOperation(r.operationId);
      expect(op!.state).toBe("confirmed");

      const result = journal.getResult(r.operationId);
      expect(result!.stdout).toBe("persisted");
    });
  });

  // ── Startup Recovery ─────────────────────────────────────────────────

  describe("recoverNonTerminalOperations", () => {
    it("created before restart does not wedge wallet lock", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, { walletAddress: "0xRECOVER" });

      // Simulate restart
      journal.close();
      journal = new OperationJournal(dbPath);

      expect(journal.hasWalletLock("0xRECOVER")).toBe(true); // lock still held

      const recovered = journal.recoverNonTerminalOperations();
      expect(recovered.failed).toContain(r.operationId);

      // Lock released after recovery
      expect(journal.hasWalletLock("0xRECOVER")).toBe(false);

      const op = journal.getOperation(r.operationId);
      expect(op!.state).toBe("failed");
      expect(op!.error_code).toBe("STARTUP_RECOVERY_REQUIRED");
    });

    it("reserved before restart does not wedge job lock", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, { jobId: "job-wedge" });
      // Manually set state to reserved
      journal.finalizeOperation(r.operationId, { state: "reserved" as any });

      journal.close();
      journal = new OperationJournal(dbPath);

      const recovered = journal.recoverNonTerminalOperations();
      expect(recovered.failed).toContain(r.operationId);
      expect(journal.hasJobLock("job-wedge")).toBe(false);
    });

    it("executing before restart becomes reconcilable/unknown", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, {});
      journal.finalizeOperation(r.operationId, { state: "executing" as any });

      journal.close();
      journal = new OperationJournal(dbPath);

      const recovered = journal.recoverNonTerminalOperations();
      expect(recovered.madeUnknown).toContain(r.operationId);

      const op = journal.getOperation(r.operationId);
      expect(op!.state).toBe("unknown");
      expect(op!.error_code).toBe("STARTUP_RECOVERY_REQUIRED");
    });

    it("confirmed before restart is not affected by recovery", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, {});
      journal.finalizeOperation(r.operationId, {
        state: "confirmed",
        txHash: "0x" + "a".repeat(64),
      });

      journal.close();
      journal = new OperationJournal(dbPath);

      const recovered = journal.recoverNonTerminalOperations();
      expect(recovered.failed).toHaveLength(0);
      expect(recovered.madeUnknown).toHaveLength(0);
    });
  });

  // ── Startup Result Loading (bounded) ─────────────────────────────────

  describe("loadConfirmedResults", () => {
    it("loads confirmed results with bound", () => {
      for (let i = 0; i < 5; i++) {
        const r = makeRecord();
        journal.createOperationWithLocks(r, {});
        journal.finalizeOperation(r.operationId, {
          state: "confirmed",
          txHash: "0x" + i.toString(16).padStart(64, "0"),
          result: { stdout: `result-${i}` },
        });
      }

      const loaded = journal.loadConfirmedResults(3);
      expect(loaded).toHaveLength(3);
    });

    it("newest entries retained when bounded", () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const r = makeRecord();
        journal.createOperationWithLocks(r, {});
        // Set explicit updated_at to ensure ordering
        journal.finalizeOperation(r.operationId, {
          state: "confirmed",
          result: { stdout: `result-${i}` },
        });
        // Manually update the timestamp to ensure deterministic ordering
        (journal as any).db.prepare(
          "UPDATE operations SET updated_at = datetime('now', ?) WHERE operation_id = ?"
        ).run(`+${i} seconds`, r.operationId);
        ids.push(r.operationId);
      }

      const loaded = journal.loadConfirmedResults(3);
      expect(loaded).toHaveLength(3);
      // Should be newest (highest offset = last inserted)
      const loadedIds = loaded.map(l => l.operationId);
      expect(loadedIds).toContain(ids[4]);
      expect(loadedIds).toContain(ids[3]);
      expect(loadedIds).toContain(ids[2]);
    });

    it("startup reload respects MAX_RESULT_CACHE_ENTRIES", () => {
      for (let i = 0; i < 10; i++) {
        const r = makeRecord();
        journal.createOperationWithLocks(r, {});
        journal.finalizeOperation(r.operationId, {
          state: "confirmed",
          result: { stdout: `result-${i}` },
        });
      }

      const loaded = journal.loadConfirmedResults(5);
      expect(loaded).toHaveLength(5); // bounded to 5
    });
  });

  // ── Reconciliation ───────────────────────────────────────────────────

  describe("reconciliation", () => {
    it("getReconcilableOperations returns broadcast/unknown", () => {
      const r1 = makeRecord();
      journal.createOperationWithLocks(r1, {});
      journal.finalizeOperation(r1.operationId, { state: "broadcast", txHash: "0x" + "a".repeat(64) });

      const r2 = makeRecord();
      journal.createOperationWithLocks(r2, {});
      journal.finalizeOperation(r2.operationId, { state: "unknown" });

      const reconcilable = journal.getReconcilableOperations();
      expect(reconcilable).toHaveLength(2);
    });

    it("reconcileOperation confirmed clears stale error fields", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, {});
      journal.finalizeOperation(r.operationId, {
        state: "unknown",
        errorCode: "UNKNOWN_TX_STATE",
        errorMessage: "timeout",
      });

      journal.reconcileOperation(r.operationId, "confirmed", { txHash: "0x" + "a".repeat(64) });

      const op = journal.getOperation(r.operationId);
      expect(op!.state).toBe("confirmed");
      expect(op!.error_code).toBeNull();
      expect(op!.error_message).toBeNull();
      expect(op!.tx_hash).toBe("0x" + "a".repeat(64));
    });

    it("reconcileOperation confirmed releases locks", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, { walletAddress: "0xRECONCILE", jobId: "job-recon" });
      journal.finalizeOperation(r.operationId, { state: "broadcast" });

      journal.reconcileOperation(r.operationId, "confirmed");

      expect(journal.hasWalletLock("0xRECONCILE")).toBe(false);
      expect(journal.hasJobLock("job-recon")).toBe(false);
    });

    it("reconcileOperation failed persists errorCode with default", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, {});
      journal.finalizeOperation(r.operationId, { state: "broadcast" });

      journal.reconcileOperation(r.operationId, "failed");

      const op = journal.getOperation(r.operationId);
      expect(op!.state).toBe("failed");
      expect(op!.error_code).toBe("BROADCAST_FAILED");
      expect(op!.error_message).toBe("Reconciled as failed");
    });

    it("failed reconciliation survives restart with errorCode/errorMessage", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, {});
      journal.finalizeOperation(r.operationId, { state: "broadcast" });
      journal.reconcileOperation(r.operationId, "failed", {
        errorCode: "BROADCAST_FAILED",
        errorMessage: "Verified: tx reverted",
      });

      journal.close();
      journal = new OperationJournal(dbPath);

      const op = journal.getOperation(r.operationId);
      expect(op!.state).toBe("failed");
      expect(op!.error_code).toBe("BROADCAST_FAILED");
      expect(op!.error_message).toBe("Verified: tx reverted");
    });
  });

  // ── Transaction Safety ───────────────────────────────────────────────

  describe("transaction safety", () => {
    it("transaction rolls back on error", () => {
      const r = makeRecord();
      journal.createOperationWithLocks(r, {});

      try {
        journal.transaction(() => {
          journal.finalizeOperation(r.operationId, { state: "confirmed" });
          throw new Error("rollback!");
        });
      } catch {
        // expected
      }

      const op = journal.getOperation(r.operationId);
      expect(op!.state).toBe("created"); // unchanged
    });
  });
});
