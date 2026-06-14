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
    if (existsSync(dbPath)) unlinkSync(dbPath);
    // WAL/SHM files
    if (existsSync(dbPath + "-wal")) unlinkSync(dbPath + "-wal");
    if (existsSync(dbPath + "-shm")) unlinkSync(dbPath + "-shm");
  });

  // ── Schema Migrations ────────────────────────────────────────────────

  describe("schema migrations", () => {
    it("creates all tables on first open", () => {
      expect(journal.getSchemaVersion()).toBe(1);
    });

    it("migrations are idempotent — reopening with same version does not fail", () => {
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

  // ── Operation CRUD ───────────────────────────────────────────────────

  describe("operation CRUD", () => {
    it("inserts and retrieves an operation", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      const row = journal.getOperation(record.operationId);
      expect(row).toBeDefined();
      expect(row!.operation_id).toBe(record.operationId);
      expect(row!.state).toBe("created");
    });

    it("updates operation state", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.updateOperation(record.operationId, { state: "confirmed" });

      const row = journal.getOperation(record.operationId);
      expect(row!.state).toBe("confirmed");
    });

    it("updates tx_hash", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      const txHash = "0x" + "a".repeat(64);
      journal.updateOperation(record.operationId, { txHash });

      const row = journal.getOperation(record.operationId);
      expect(row!.tx_hash).toBe(txHash);
    });

    it("updates error_code and error_message", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.updateOperation(record.operationId, {
        errorCode: "BROADCAST_FAILED",
        errorMessage: "Insufficient funds",
      });

      const row = journal.getOperation(record.operationId);
      expect(row!.error_code).toBe("BROADCAST_FAILED");
      expect(row!.error_message).toBe("Insufficient funds");
    });

    it("deletes operation and cascading records", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.storeResult(record.operationId, { stdout: "test" });
      journal.storeReceipt(record.operationId, { receiptId: "r-1" });

      journal.deleteOperation(record.operationId);

      expect(journal.getOperation(record.operationId)).toBeUndefined();
      expect(journal.getResult(record.operationId)).toBeUndefined();
      expect(journal.getReceipt(record.operationId)).toBeUndefined();
    });

    it("returns undefined for non-existent operation", () => {
      expect(journal.getOperation("non-existent")).toBeUndefined();
    });

    it("getOperationsByState returns correct operations", () => {
      const r1 = makeRecord({ state: "confirmed" });
      const r2 = makeRecord({ state: "failed" });
      const r3 = makeRecord({ state: "confirmed" });

      journal.insertOperation(r1);
      journal.insertOperation(r2);
      journal.insertOperation(r3);

      const confirmed = journal.getOperationsByState("confirmed");
      expect(confirmed).toHaveLength(2);

      const failed = journal.getOperationsByState("failed");
      expect(failed).toHaveLength(1);
    });

    it("getOperationCount returns total count", () => {
      expect(journal.getOperationCount()).toBe(0);
      journal.insertOperation(makeRecord());
      expect(journal.getOperationCount()).toBe(1);
      journal.insertOperation(makeRecord());
      expect(journal.getOperationCount()).toBe(2);
    });
  });

  // ── Idempotency ──────────────────────────────────────────────────────

  describe("idempotency keys", () => {
    it("finds operation by idempotency key + params hash", () => {
      const record = makeRecord({
        idempotencyKey: "key-1",
        paramsHash: "0x" + "a".repeat(64),
      });
      journal.insertOperation(record);

      const found = journal.findByIdempotencyKey("key-1", "0x" + "a".repeat(64));
      expect(found).toBeDefined();
      expect(found!.operation_id).toBe(record.operationId);
    });

    it("returns undefined for non-matching idempotency key", () => {
      const record = makeRecord({ idempotencyKey: "key-1" });
      journal.insertOperation(record);

      expect(journal.findByIdempotencyKey("key-2", record.paramsHash)).toBeUndefined();
    });

    it("detects idempotency conflict (same key, different params)", () => {
      const record = makeRecord({
        idempotencyKey: "key-1",
        paramsHash: "0x" + "a".repeat(64),
      });
      journal.insertOperation(record);

      const conflict = journal.findIdempotencyConflict("key-1", "0x" + "b".repeat(64));
      expect(conflict).toBeDefined();
      expect(conflict!.operation_id).toBe(record.operationId);
    });

    it("returns undefined when same key + same params (no conflict)", () => {
      const record = makeRecord({
        idempotencyKey: "key-1",
        paramsHash: "0x" + "a".repeat(64),
      });
      journal.insertOperation(record);

      expect(journal.findIdempotencyConflict("key-1", "0x" + "a".repeat(64))).toBeUndefined();
    });

    it("idempotency survives restart", () => {
      const record = makeRecord({
        idempotencyKey: "key-persist",
        paramsHash: "0x" + "c".repeat(64),
      });
      journal.insertOperation(record);
      journal.updateOperation(record.operationId, { state: "confirmed" });

      // Simulate restart
      journal.close();
      journal = new OperationJournal(dbPath);

      const found = journal.findByIdempotencyKey("key-persist", "0x" + "c".repeat(64));
      expect(found).toBeDefined();
      expect(found!.state).toBe("confirmed");
    });
  });

  // ── Operation Results ────────────────────────────────────────────────

  describe("operation results", () => {
    it("stores and retrieves compact result", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      journal.storeResult(record.operationId, {
        stdout: '{"txHash":"0xabc"}',
        stderr: "",
        json: { txHash: "0xabc", status: "confirmed" },
        exitCode: 0,
      });

      const result = journal.getResult(record.operationId);
      expect(result).toBeDefined();
      expect(result!.stdout).toBe('{"txHash":"0xabc"}');
      expect(JSON.parse(result!.json_data!)).toEqual({ txHash: "0xabc", status: "confirmed" });
    });

    it("overwrites result on re-store (INSERT OR REPLACE)", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      journal.storeResult(record.operationId, { stdout: "first" });
      journal.storeResult(record.operationId, { stdout: "second" });

      const result = journal.getResult(record.operationId);
      expect(result!.stdout).toBe("second");
    });

    it("result survives restart", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.storeResult(record.operationId, { stdout: "persisted" });

      journal.close();
      journal = new OperationJournal(dbPath);

      const result = journal.getResult(record.operationId);
      expect(result!.stdout).toBe("persisted");
    });
  });

  // ── Receipt Proof Metadata ───────────────────────────────────────────

  describe("receipt proof metadata", () => {
    it("stores and retrieves receipt", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      journal.storeReceipt(record.operationId, {
        receiptId: "receipt-1",
        receiptHash: "0x" + "d".repeat(64),
        proofKind: "erc8183-submit",
        proofData: { jobId: 42, deliverableHash: "0xabc" },
      });

      const receipt = journal.getReceipt(record.operationId);
      expect(receipt).toBeDefined();
      expect(receipt!.receipt_id).toBe("receipt-1");
      expect(receipt!.proof_kind).toBe("erc8183-submit");
      expect(JSON.parse(receipt!.proof_data!)).toEqual({ jobId: 42, deliverableHash: "0xabc" });
    });

    it("receipt survives restart", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.storeReceipt(record.operationId, { receiptId: "r-persist" });

      journal.close();
      journal = new OperationJournal(dbPath);

      const receipt = journal.getReceipt(record.operationId);
      expect(receipt!.receipt_id).toBe("r-persist");
    });
  });

  // ── Wallet Locks ─────────────────────────────────────────────────────

  describe("wallet locks", () => {
    it("acquires wallet lock", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      const acquired = journal.acquireWalletLock("0xABC", record.operationId);
      expect(acquired).toBe(true);
      expect(journal.hasWalletLock("0xABC")).toBe(true);
    });

    it("blocks concurrent same-wallet writes", () => {
      const r1 = makeRecord();
      const r2 = makeRecord();
      journal.insertOperation(r1);
      journal.insertOperation(r2);

      expect(journal.acquireWalletLock("0xABC", r1.operationId)).toBe(true);
      expect(journal.acquireWalletLock("0xABC", r2.operationId)).toBe(false);
    });

    it("releases wallet lock", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      journal.acquireWalletLock("0xABC", record.operationId);
      journal.releaseWalletLock("0xABC");

      expect(journal.hasWalletLock("0xABC")).toBe(false);
    });

    it("wallet lock is case-insensitive", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      journal.acquireWalletLock("0xABC", record.operationId);
      expect(journal.hasWalletLock("0xabc")).toBe(true);
      expect(journal.hasWalletLock("0xABC")).toBe(true);
    });

    it("getWalletLockOperation returns the holding operation", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      journal.acquireWalletLock("0xABC", record.operationId);
      expect(journal.getWalletLockOperation("0xABC")).toBe(record.operationId);
    });

    it("wallet lock survives restart", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.acquireWalletLock("0xPERSIST", record.operationId);

      journal.close();
      journal = new OperationJournal(dbPath);

      expect(journal.hasWalletLock("0xPERSIST")).toBe(true);
      expect(journal.getWalletLockOperation("0xPERSIST")).toBe(record.operationId);
    });
  });

  // ── Job Locks ────────────────────────────────────────────────────────

  describe("job locks", () => {
    it("acquires job lock", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      const acquired = journal.acquireJobLock("job-42", record.operationId);
      expect(acquired).toBe(true);
      expect(journal.hasJobLock("job-42")).toBe(true);
    });

    it("blocks concurrent same-job writes", () => {
      const r1 = makeRecord();
      const r2 = makeRecord();
      journal.insertOperation(r1);
      journal.insertOperation(r2);

      expect(journal.acquireJobLock("job-42", r1.operationId)).toBe(true);
      expect(journal.acquireJobLock("job-42", r2.operationId)).toBe(false);
    });

    it("releases job lock", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      journal.acquireJobLock("job-42", record.operationId);
      journal.releaseJobLock("job-42");

      expect(journal.hasJobLock("job-42")).toBe(false);
    });

    it("getJobLockOperation returns the holding operation", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      journal.acquireJobLock("job-42", record.operationId);
      expect(journal.getJobLockOperation("job-42")).toBe(record.operationId);
    });

    it("job lock survives restart", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.acquireJobLock("job-persist", record.operationId);

      journal.close();
      journal = new OperationJournal(dbPath);

      expect(journal.hasJobLock("job-persist")).toBe(true);
    });

    it("locks release on confirmed (via releaseLocksForOperation)", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      journal.acquireWalletLock("0xW", record.operationId);
      journal.acquireJobLock("job-1", record.operationId);

      journal.releaseLocksForOperation(record.operationId);

      expect(journal.hasWalletLock("0xW")).toBe(false);
      expect(journal.hasJobLock("job-1")).toBe(false);
    });
  });

  // ── Startup Reconciliation ───────────────────────────────────────────

  describe("startup reconciliation", () => {
    it("returns broadcast operations as reconcilable", () => {
      const record = makeRecord({ state: "broadcast" });
      record.txHash = "0x" + "a".repeat(64);
      journal.insertOperation(record);
      journal.updateOperation(record.operationId, { state: "broadcast", txHash: "0x" + "a".repeat(64) });

      const reconcilable = journal.getReconcilableOperations();
      expect(reconcilable).toHaveLength(1);
      expect(reconcilable[0].state).toBe("broadcast");
      expect(reconcilable[0].txHash).toBeDefined();
    });

    it("returns unknown operations as reconcilable", () => {
      const record = makeRecord({ state: "unknown" });
      journal.insertOperation(record);
      journal.updateOperation(record.operationId, { state: "unknown" });

      const reconcilable = journal.getReconcilableOperations();
      expect(reconcilable).toHaveLength(1);
      expect(reconcilable[0].state).toBe("unknown");
    });

    it("does not return confirmed/failed operations as reconcilable", () => {
      journal.insertOperation(makeRecord({ state: "confirmed" }));
      journal.insertOperation(makeRecord({ state: "failed" }));

      expect(journal.getReconcilableOperations()).toHaveLength(0);
    });

    it("reconcileOperation transitions broadcast → confirmed", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.updateOperation(record.operationId, { state: "broadcast" });

      journal.reconcileOperation(record.operationId, "confirmed", {
        txHash: "0x" + "a".repeat(64),
      });

      const row = journal.getOperation(record.operationId);
      expect(row!.state).toBe("confirmed");
      expect(row!.tx_hash).toBe("0x" + "a".repeat(64));
    });

    it("reconcileOperation transitions unknown → failed", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.updateOperation(record.operationId, { state: "unknown" });

      journal.reconcileOperation(record.operationId, "failed", {
        errorCode: "BROADCAST_FAILED",
        errorMessage: "Reconciled as failed after verification",
      });

      const row = journal.getOperation(record.operationId);
      expect(row!.state).toBe("failed");
      expect(row!.error_code).toBe("BROADCAST_FAILED");
    });

    it("reconcileOperation releases locks for terminal states", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.updateOperation(record.operationId, { state: "broadcast" });
      journal.acquireWalletLock("0xRECONCILE", record.operationId);
      journal.acquireJobLock("job-reconcile", record.operationId);

      journal.reconcileOperation(record.operationId, "confirmed");

      expect(journal.hasWalletLock("0xRECONCILE")).toBe(false);
      expect(journal.hasJobLock("job-reconcile")).toBe(false);
    });

    it("reconcilable operations survive restart", () => {
      const record = makeRecord();
      journal.insertOperation(record);
      journal.updateOperation(record.operationId, {
        state: "broadcast",
        txHash: "0x" + "e".repeat(64),
      });

      journal.close();
      journal = new OperationJournal(dbPath);

      const reconcilable = journal.getReconcilableOperations();
      expect(reconcilable).toHaveLength(1);
      expect(reconcilable[0].operationId).toBe(record.operationId);
      expect(reconcilable[0].state).toBe("broadcast");
    });
  });

  // ── Full Lifecycle ───────────────────────────────────────────────────

  describe("full operation lifecycle", () => {
    it("write → confirm → replay returns cached result", () => {
      const record = makeRecord({
        idempotencyKey: "lifecycle-key",
        paramsHash: "0x" + "f".repeat(64),
      });
      journal.insertOperation(record);

      // Simulate state transitions
      journal.updateOperation(record.operationId, { state: "prepared" });
      journal.updateOperation(record.operationId, { state: "reserved" });
      journal.updateOperation(record.operationId, { state: "executing" });
      journal.updateOperation(record.operationId, { state: "broadcast" });
      journal.updateOperation(record.operationId, { state: "confirmed", txHash: "0x" + "a".repeat(64) });

      // Store result
      journal.storeResult(record.operationId, {
        stdout: '{"status":"confirmed","txHash":"0xaaa..."}',
        json: { status: "confirmed" },
      });

      // Idempotent replay
      const found = journal.findByIdempotencyKey("lifecycle-key", "0x" + "f".repeat(64));
      expect(found).toBeDefined();
      expect(found!.state).toBe("confirmed");

      const result = journal.getResult(record.operationId);
      expect(result).toBeDefined();
      expect(JSON.parse(result!.json_data!).status).toBe("confirmed");
    });

    it("failed → retry → delete old → insert new", () => {
      const key = "retry-key";
      const params = "0x" + "a".repeat(64);

      const r1 = makeRecord({ idempotencyKey: key, paramsHash: params, state: "failed" });
      journal.insertOperation(r1);
      journal.updateOperation(r1.operationId, { state: "failed", errorCode: "BROADCAST_FAILED" });

      // Allow retry: delete old
      journal.deleteOperation(r1.operationId);

      // Insert new
      const r2 = makeRecord({ idempotencyKey: key, paramsHash: params });
      journal.insertOperation(r2);
      journal.updateOperation(r2.operationId, { state: "confirmed" });

      const found = journal.findByIdempotencyKey(key, params);
      expect(found!.operation_id).toBe(r2.operationId);
      expect(found!.state).toBe("confirmed");
    });
  });

  // ── Transaction Safety ───────────────────────────────────────────────

  describe("transaction safety", () => {
    it("transaction rolls back on error", () => {
      const record = makeRecord();
      journal.insertOperation(record);

      try {
        journal.transaction(() => {
          journal.updateOperation(record.operationId, { state: "prepared" });
          throw new Error("rollback!");
        });
      } catch {
        // expected
      }

      // State should be unchanged
      const row = journal.getOperation(record.operationId);
      expect(row!.state).toBe("created");
    });
  });
});
