/**
 * OperationJournal — SQLite-backed persistence for ExecutionGateway.
 *
 * Phase 5: restart-safe operation journal, idempotency keys, wallet/job locks,
 * result/receipt metadata, and startup reconciliation hooks.
 *
 * Design:
 *   - WAL mode for concurrent read safety
 *   - foreign_keys ON for referential integrity
 *   - busy_timeout for lock contention
 *   - BEGIN IMMEDIATE for transactional writes
 *   - Schema versioning via schema_migrations table
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { OperationRecord, OperationState, OperationErrorCode } from "@arclayer/runner-core";

// ── Schema Version ─────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

// ── Schema SQL ─────────────────────────────────────────────────────────

const SCHEMA_SQL = `
-- Schema migrations tracker
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT    NOT NULL DEFAULT (datetime('now')),
  checksum   TEXT
);

-- Core operation records
CREATE TABLE IF NOT EXISTS operations (
  operation_id      TEXT PRIMARY KEY,
  idempotency_key   TEXT NOT NULL,
  params_hash       TEXT NOT NULL,
  kind              TEXT NOT NULL,
  agent_id          TEXT,
  wallet_address    TEXT,
  chain_id          INTEGER,
  contract_address  TEXT,
  description       TEXT,
  state             TEXT NOT NULL DEFAULT 'created',
  tx_hash           TEXT,
  error_code        TEXT,
  error_message     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_operations_state ON operations(state);
CREATE INDEX IF NOT EXISTS idx_operations_idempotency ON operations(idempotency_key, params_hash);
CREATE INDEX IF NOT EXISTS idx_operations_wallet ON operations(wallet_address);
CREATE INDEX IF NOT EXISTS idx_operations_kind ON operations(kind);

-- Idempotency key index (composite key → operation_id)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  composite_key   TEXT PRIMARY KEY,
  operation_id    TEXT NOT NULL REFERENCES operations(operation_id),
  idempotency_key TEXT NOT NULL,
  params_hash     TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON idempotency_keys(idempotency_key, params_hash);

-- Wallet locks (one active write per wallet)
CREATE TABLE IF NOT EXISTS wallet_locks (
  wallet_address TEXT PRIMARY KEY,
  operation_id   TEXT NOT NULL REFERENCES operations(operation_id),
  acquired_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Job locks (one active write per ERC-8183 job)
CREATE TABLE IF NOT EXISTS job_locks (
  job_id       TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(operation_id),
  acquired_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Compact Circle CLI results (for idempotent replay)
CREATE TABLE IF NOT EXISTS operation_results (
  operation_id  TEXT PRIMARY KEY REFERENCES operations(operation_id),
  stdout        TEXT,
  stderr        TEXT,
  json_data     TEXT,
  exit_code     INTEGER,
  stored_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Receipt proof metadata (references JSONL receipts)
CREATE TABLE IF NOT EXISTS operation_receipts (
  operation_id    TEXT PRIMARY KEY REFERENCES operations(operation_id),
  receipt_id      TEXT,
  receipt_hash    TEXT,
  proof_kind      TEXT,
  proof_data      TEXT,
  stored_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ── Types ──────────────────────────────────────────────────────────────

export type JournalOperationRow = {
  operation_id: string;
  idempotency_key: string;
  params_hash: string;
  kind: string;
  agent_id: string | null;
  wallet_address: string | null;
  chain_id: number | null;
  contract_address: string | null;
  description: string | null;
  state: string;
  tx_hash: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type JournalResultRow = {
  operation_id: string;
  stdout: string | null;
  stderr: string | null;
  json_data: string | null;
  exit_code: number | null;
};

export type JournalReceiptRow = {
  operation_id: string;
  receipt_id: string | null;
  receipt_hash: string | null;
  proof_kind: string | null;
  proof_data: string | null;
};

export type ReconcilableOperation = {
  operationId: string;
  idempotencyKey: string;
  kind: string;
  state: OperationState;
  txHash?: string;
  errorCode?: OperationErrorCode;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

// ── Lock input types ───────────────────────────────────────────────────

export type LockRequest = {
  walletAddress?: string;
  jobId?: string;
};

// ── OperationJournal ───────────────────────────────────────────────────

export class OperationJournal {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);

    // WAL mode: concurrent reads, single writer
    this.db.pragma("journal_mode = WAL");
    // Foreign key enforcement
    this.db.pragma("foreign_keys = ON");
    // 5 second busy timeout for lock contention
    this.db.pragma("busy_timeout = 5000");

    this.runMigrations();
  }

  // ── Schema Migrations ────────────────────────────────────────────────

  private runMigrations(): void {
    const currentVersion = this.getCurrentVersion();
    if (currentVersion >= SCHEMA_VERSION) return;

    const txn = this.db.transaction(() => {
      // Apply all schema SQL
      this.db.exec(SCHEMA_SQL);

      // Record migration
      this.db.prepare(`
        INSERT OR IGNORE INTO schema_migrations (version, checksum) VALUES (?, ?)
      `).run(SCHEMA_VERSION, `phase5-v${SCHEMA_VERSION}`);
    });

    txn();
  }

  private getCurrentVersion(): number {
    // Check if schema_migrations table exists
    const tableExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).get() as { name: string } | undefined;

    if (!tableExists) return 0;

    const row = this.db.prepare(
      "SELECT MAX(version) as version FROM schema_migrations"
    ).get() as { version: number | null } | undefined;

    return row?.version ?? 0;
  }

  /** Get the current schema version (for testing). */
  getSchemaVersion(): number {
    return this.getCurrentVersion();
  }

  // ── Atomic Operation Creation with Locks ─────────────────────────────

  /**
   * Atomically create an operation with idempotency reservation and lock acquisition.
   *
   * All-or-nothing: if any step fails (idempotency conflict, lock conflict),
   * nothing is persisted. No stale operation/idempotency rows remain.
   *
   * Returns:
   *   - { ok: true, operationId } on success
   *   - { ok: false, error: "IDEMPOTENCY_CONFLICT", existing }
   *   - { ok: false, error: "IDEMPOTENCY_KEY_EXISTS", existing }
   *   - { ok: false, error: "WALLET_LOCKED", lockedBy }
   *   - { ok: false, error: "JOB_LOCKED", lockedBy }
   */
  createOperationWithLocks(
    record: OperationRecord,
    locks: LockRequest
  ): { ok: true; operationId: string } | { ok: false; error: string; details?: unknown } {
    const txn = this.db.transaction(() => {
      const compositeKey = `${record.idempotencyKey}:${record.paramsHash}`;

      // 1. Check idempotency: same key + same params → already exists
      const existingKey = this.db.prepare(
        "SELECT operation_id FROM idempotency_keys WHERE idempotency_key = ? AND params_hash = ?"
      ).get(record.idempotencyKey, record.paramsHash) as { operation_id: string } | undefined;

      if (existingKey) {
        const existingOp = this.db.prepare(
          "SELECT * FROM operations WHERE operation_id = ?"
        ).get(existingKey.operation_id) as JournalOperationRow | undefined;
        return { ok: false as const, error: "IDEMPOTENCY_KEY_EXISTS", details: existingOp };
      }

      // 2. Check idempotency conflict: same key + different params
      const conflictKey = this.db.prepare(
        "SELECT operation_id FROM idempotency_keys WHERE idempotency_key = ? AND params_hash != ? LIMIT 1"
      ).get(record.idempotencyKey, record.paramsHash) as { operation_id: string } | undefined;

      if (conflictKey) {
        const conflictOp = this.db.prepare(
          "SELECT * FROM operations WHERE operation_id = ?"
        ).get(conflictKey.operation_id) as JournalOperationRow | undefined;
        return { ok: false as const, error: "IDEMPOTENCY_CONFLICT", details: conflictOp };
      }

      // 3. Check wallet lock
      if (locks.walletAddress) {
        const walletLock = this.db.prepare(
          "SELECT operation_id FROM wallet_locks WHERE wallet_address = ?"
        ).get(locks.walletAddress.toLowerCase()) as { operation_id: string } | undefined;

        if (walletLock) {
          return { ok: false as const, error: "WALLET_LOCKED", details: { lockedBy: walletLock.operation_id } };
        }
      }

      // 4. Check job lock
      if (locks.jobId) {
        const jobLock = this.db.prepare(
          "SELECT operation_id FROM job_locks WHERE job_id = ?"
        ).get(locks.jobId) as { operation_id: string } | undefined;

        if (jobLock) {
          return { ok: false as const, error: "JOB_LOCKED", details: { lockedBy: jobLock.operation_id } };
        }
      }

      // 5. All checks passed — insert everything atomically
      this.db.prepare(`
        INSERT INTO operations (
          operation_id, idempotency_key, params_hash, kind,
          agent_id, wallet_address, chain_id, contract_address,
          description, state, tx_hash, error_code, error_message,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.operationId,
        record.idempotencyKey,
        record.paramsHash,
        record.toolName,
        record.agentId ?? null,
        record.walletAddress ?? null,
        record.chainId ?? null,
        record.contractAddress ?? null,
        (record as any).description ?? null,
        record.state,
        record.txHash ?? null,
        record.errorCode ?? null,
        record.errorMessage ?? null,
        record.createdAt,
        record.updatedAt,
      );

      // 6. Reserve idempotency key
      this.db.prepare(`
        INSERT INTO idempotency_keys (composite_key, operation_id, idempotency_key, params_hash)
        VALUES (?, ?, ?, ?)
      `).run(compositeKey, record.operationId, record.idempotencyKey, record.paramsHash);

      // 7. Acquire wallet lock
      if (locks.walletAddress) {
        this.db.prepare(`
          INSERT INTO wallet_locks (wallet_address, operation_id) VALUES (?, ?)
        `).run(locks.walletAddress.toLowerCase(), record.operationId);
      }

      // 8. Acquire job lock
      if (locks.jobId) {
        this.db.prepare(`
          INSERT INTO job_locks (job_id, operation_id) VALUES (?, ?)
        `).run(locks.jobId, record.operationId);
      }

      return { ok: true as const, operationId: record.operationId };
    });

    return txn();
  }

  // ── Atomic Operation Finalization ────────────────────────────────────

  /**
   * Atomically finalize an operation: update state, persist result/receipt metadata,
   * release locks. All in one transaction — no crash window between confirmed and
   * metadata persistence.
   */
  finalizeOperation(
    operationId: string,
    finalization: {
      state: OperationState;
      txHash?: string;
      errorCode?: OperationErrorCode;
      errorMessage?: string;
      result?: { stdout?: string; stderr?: string; json?: unknown; exitCode?: number };
      receipt?: { receiptId?: string; receiptHash?: string; proofKind?: string; proofData?: unknown };
    }
  ): void {
    const txn = this.db.transaction(() => {
      // 1. Update operation state + metadata
      const sets: string[] = ["updated_at = datetime('now')"];
      const params: unknown[] = [];

      sets.push("state = ?");
      params.push(finalization.state);

      if (finalization.txHash !== undefined) {
        sets.push("tx_hash = ?");
        params.push(finalization.txHash);
      }
      if (finalization.errorCode !== undefined) {
        sets.push("error_code = ?");
        params.push(finalization.errorCode);
      }
      if (finalization.errorMessage !== undefined) {
        sets.push("error_message = ?");
        params.push(finalization.errorMessage);
      }

      params.push(operationId);

      this.db.prepare(
        `UPDATE operations SET ${sets.join(", ")} WHERE operation_id = ?`
      ).run(...params);

      // 2. Store compact result
      if (finalization.result) {
        this.db.prepare(`
          INSERT OR REPLACE INTO operation_results (operation_id, stdout, stderr, json_data, exit_code)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          operationId,
          finalization.result.stdout ?? null,
          finalization.result.stderr ?? null,
          finalization.result.json ? JSON.stringify(finalization.result.json) : null,
          finalization.result.exitCode ?? null,
        );
      }

      // 3. Store receipt metadata
      if (finalization.receipt) {
        this.db.prepare(`
          INSERT OR REPLACE INTO operation_receipts (operation_id, receipt_id, receipt_hash, proof_kind, proof_data)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          operationId,
          finalization.receipt.receiptId ?? null,
          finalization.receipt.receiptHash ?? null,
          finalization.receipt.proofKind ?? null,
          finalization.receipt.proofData ? JSON.stringify(finalization.receipt.proofData) : null,
        );
      }

      // 4. Release locks for terminal states
      if (finalization.state === "confirmed" || finalization.state === "failed" || finalization.state === "cancelled") {
        this.db.prepare("DELETE FROM wallet_locks WHERE operation_id = ?").run(operationId);
        this.db.prepare("DELETE FROM job_locks WHERE operation_id = ?").run(operationId);
      }
    });

    txn();
  }

  // ── Operation Queries ────────────────────────────────────────────────

  /** Get an operation by ID. */
  getOperation(operationId: string): JournalOperationRow | undefined {
    return this.db.prepare(
      "SELECT * FROM operations WHERE operation_id = ?"
    ).get(operationId) as JournalOperationRow | undefined;
  }

  /** Get all operations in a given state. */
  getOperationsByState(state: OperationState): JournalOperationRow[] {
    return this.db.prepare(
      "SELECT * FROM operations WHERE state = ? ORDER BY created_at ASC"
    ).all(state) as JournalOperationRow[];
  }

  /** Get total operation count. */
  getOperationCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM operations").get() as { count: number };
    return row.count;
  }

  /**
   * Delete an operation and all related records.
   * Used when allowing retry for failed/cancelled operations.
   */
  deleteOperation(operationId: string): void {
    const txn = this.db.transaction(() => {
      this.db.prepare("DELETE FROM operation_receipts WHERE operation_id = ?").run(operationId);
      this.db.prepare("DELETE FROM operation_results WHERE operation_id = ?").run(operationId);
      this.db.prepare("DELETE FROM wallet_locks WHERE operation_id = ?").run(operationId);
      this.db.prepare("DELETE FROM job_locks WHERE operation_id = ?").run(operationId);
      this.db.prepare("DELETE FROM idempotency_keys WHERE operation_id = ?").run(operationId);
      this.db.prepare("DELETE FROM operations WHERE operation_id = ?").run(operationId);
    });
    txn();
  }

  // ── Operation Results (compact Circle CLI output) ────────────────────

  /** Get stored result for idempotent replay. */
  getResult(operationId: string): JournalResultRow | undefined {
    return this.db.prepare(
      "SELECT * FROM operation_results WHERE operation_id = ?"
    ).get(operationId) as JournalResultRow | undefined;
  }

  // ── Receipt Proof Metadata ───────────────────────────────────────────

  /** Get stored receipt proof metadata. */
  getReceipt(operationId: string): JournalReceiptRow | undefined {
    return this.db.prepare(
      "SELECT * FROM operation_receipts WHERE operation_id = ?"
    ).get(operationId) as JournalReceiptRow | undefined;
  }

  // ── Startup Recovery ─────────────────────────────────────────────────

  /**
   * Recover non-terminal operations on startup.
   *
   * Pre-terminal states that may have been interrupted:
   *   - created, prepared, reserved: never reached Circle CLI → safe to fail + release locks
   *   - executing: may have sent tx → move to unknown (reconcilable)
   *
   * Returns recovered operation IDs.
   */
  recoverNonTerminalOperations(): { failed: string[]; madeUnknown: string[] } {
    const failed: string[] = [];
    const madeUnknown: string[] = [];

    const txn = this.db.transaction(() => {
      // created, prepared, reserved → failed with STARTUP_RECOVERY_REQUIRED
      const preBroadcast = this.db.prepare(
        "SELECT operation_id FROM operations WHERE state IN ('created', 'prepared', 'reserved')"
      ).all() as { operation_id: string }[];

      for (const row of preBroadcast) {
        this.db.prepare(`
          UPDATE operations SET state = 'failed', error_code = 'STARTUP_RECOVERY_REQUIRED',
          error_message = 'Operation was in pre-broadcast state at shutdown. Safe to retry.',
          updated_at = datetime('now') WHERE operation_id = ?
        `).run(row.operation_id);
        this.db.prepare("DELETE FROM wallet_locks WHERE operation_id = ?").run(row.operation_id);
        this.db.prepare("DELETE FROM job_locks WHERE operation_id = ?").run(row.operation_id);
        failed.push(row.operation_id);
      }

      // executing → unknown (may have broadcast tx)
      const executing = this.db.prepare(
        "SELECT operation_id FROM operations WHERE state = 'executing'"
      ).all() as { operation_id: string }[];

      for (const row of executing) {
        this.db.prepare(`
          UPDATE operations SET state = 'unknown', error_code = 'STARTUP_RECOVERY_REQUIRED',
          error_message = 'Operation was executing at shutdown. Tx may have been broadcast. Reconciliation required.',
          updated_at = datetime('now') WHERE operation_id = ?
        `).run(row.operation_id);
        madeUnknown.push(row.operation_id);
      }
    });

    txn();
    return { failed, madeUnknown };
  }

  // ── Startup Reconciliation ───────────────────────────────────────────

  /**
   * Get all operations that need reconciliation on startup.
   * These are operations in broadcast or unknown state.
   */
  getReconcilableOperations(): ReconcilableOperation[] {
    const rows = this.db.prepare(
      "SELECT * FROM operations WHERE state IN ('broadcast', 'unknown') ORDER BY created_at ASC"
    ).all() as JournalOperationRow[];

    return rows.map(row => ({
      operationId: row.operation_id,
      idempotencyKey: row.idempotency_key,
      kind: row.kind,
      state: row.state as OperationState,
      txHash: row.tx_hash ?? undefined,
      errorCode: (row.error_code ?? undefined) as OperationErrorCode | undefined,
      errorMessage: row.error_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Reconcile an operation to a final state.
   * Atomic: updates state, persists metadata, releases locks in one transaction.
   */
  reconcileOperation(
    operationId: string,
    outcome: "confirmed" | "failed" | "unknown",
    details?: { txHash?: string; errorCode?: OperationErrorCode; errorMessage?: string }
  ): void {
    const txn = this.db.transaction(() => {
      const sets: string[] = ["updated_at = datetime('now')"];
      const params: unknown[] = [];

      sets.push("state = ?");
      params.push(outcome);

      if (outcome === "confirmed") {
        // Confirmed: set txHash, clear stale error fields
        if (details?.txHash) {
          sets.push("tx_hash = ?");
          params.push(details.txHash);
        }
        sets.push("error_code = NULL");
        sets.push("error_message = NULL");
      } else if (outcome === "failed") {
        // Failed: persist error metadata with defaults
        sets.push("error_code = ?");
        params.push(details?.errorCode ?? "BROADCAST_FAILED");
        sets.push("error_message = ?");
        params.push(details?.errorMessage ?? "Reconciled as failed");
      } else {
        // Unknown: persist error metadata
        if (details?.errorCode) {
          sets.push("error_code = ?");
          params.push(details.errorCode);
        }
        if (details?.errorMessage) {
          sets.push("error_message = ?");
          params.push(details.errorMessage);
        }
      }

      params.push(operationId);

      this.db.prepare(
        `UPDATE operations SET ${sets.join(", ")} WHERE operation_id = ?`
      ).run(...params);

      // Release locks for terminal states
      if (outcome === "confirmed" || outcome === "failed") {
        this.db.prepare("DELETE FROM wallet_locks WHERE operation_id = ?").run(operationId);
        this.db.prepare("DELETE FROM job_locks WHERE operation_id = ?").run(operationId);
      }
    });

    txn();
  }

  // ── Startup Result Loading (bounded) ─────────────────────────────────

  /**
   * Load confirmed operation results for idempotent replay cache.
   * Bounded to maxEntries — newest first, oldest evicted.
   */
  loadConfirmedResults(maxEntries: number): Array<{
    operationId: string;
    idempotencyKey: string;
    paramsHash: string;
    txHash: string | null;
    result: JournalResultRow | undefined;
  }> {
    const rows = this.db.prepare(`
      SELECT o.operation_id, o.idempotency_key, o.params_hash, o.tx_hash
      FROM operations o
      WHERE o.state = 'confirmed'
      ORDER BY o.updated_at DESC
      LIMIT ?
    `).all(maxEntries) as Array<{
      operation_id: string;
      idempotency_key: string;
      params_hash: string;
      tx_hash: string | null;
    }>;

    return rows.map(row => ({
      operationId: row.operation_id,
      idempotencyKey: row.idempotency_key,
      paramsHash: row.params_hash,
      txHash: row.tx_hash,
      result: this.getResult(row.operation_id),
    }));
  }

  // ── Lock Helpers ─────────────────────────────────────────────────────

  /** Release all locks held by an operation. */
  releaseLocksForOperation(operationId: string): void {
    this.db.prepare("DELETE FROM wallet_locks WHERE operation_id = ?").run(operationId);
    this.db.prepare("DELETE FROM job_locks WHERE operation_id = ?").run(operationId);
  }

  /** Check if a wallet lock is held. */
  hasWalletLock(walletAddress: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM wallet_locks WHERE wallet_address = ?"
    ).get(walletAddress.toLowerCase());
    return !!row;
  }

  /** Check if a job lock is held. */
  hasJobLock(jobId: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM job_locks WHERE job_id = ?"
    ).get(jobId);
    return !!row;
  }

  /** Get the operation holding a wallet lock. */
  getWalletLockOperation(walletAddress: string): string | undefined {
    const row = this.db.prepare(
      "SELECT operation_id FROM wallet_locks WHERE wallet_address = ?"
    ).get(walletAddress.toLowerCase()) as { operation_id: string } | undefined;
    return row?.operation_id;
  }

  /** Get the operation holding a job lock. */
  getJobLockOperation(jobId: string): string | undefined {
    const row = this.db.prepare(
      "SELECT operation_id FROM job_locks WHERE job_id = ?"
    ).get(jobId) as { operation_id: string } | undefined;
    return row?.operation_id;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  /** Run inside a transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
