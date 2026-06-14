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

  // ── Operation CRUD ───────────────────────────────────────────────────

  /**
   * Insert a new operation record. Returns the operationId.
   * Must be called within a transaction that also reserves the idempotency key.
   */
  insertOperation(record: OperationRecord): void {
    const txn = this.db.transaction(() => {
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

      // Reserve idempotency key
      this.db.prepare(`
        INSERT INTO idempotency_keys (composite_key, operation_id, idempotency_key, params_hash)
        VALUES (?, ?, ?, ?)
      `).run(
        `${record.idempotencyKey}:${record.paramsHash}`,
        record.operationId,
        record.idempotencyKey,
        record.paramsHash,
      );
    });

    txn();
  }

  /**
   * Update operation state and metadata.
   * Used for state transitions and result persistence.
   */
  updateOperation(
    operationId: string,
    updates: {
      state?: OperationState;
      txHash?: string;
      errorCode?: OperationErrorCode;
      errorMessage?: string;
    }
  ): void {
    const sets: string[] = ["updated_at = datetime('now')"];
    const params: unknown[] = [];

    if (updates.state !== undefined) {
      sets.push("state = ?");
      params.push(updates.state);
    }
    if (updates.txHash !== undefined) {
      sets.push("tx_hash = ?");
      params.push(updates.txHash);
    }
    if (updates.errorCode !== undefined) {
      sets.push("error_code = ?");
      params.push(updates.errorCode);
    }
    if (updates.errorMessage !== undefined) {
      sets.push("error_message = ?");
      params.push(updates.errorMessage);
    }

    params.push(operationId);

    this.db.prepare(
      `UPDATE operations SET ${sets.join(", ")} WHERE operation_id = ?`
    ).run(...params);
  }

  /**
   * Get an operation by ID.
   */
  getOperation(operationId: string): JournalOperationRow | undefined {
    return this.db.prepare(
      "SELECT * FROM operations WHERE operation_id = ?"
    ).get(operationId) as JournalOperationRow | undefined;
  }

  /**
   * Look up an operation by idempotency key + params hash.
   */
  findByIdempotencyKey(idempotencyKey: string, paramsHash: string): JournalOperationRow | undefined {
    const row = this.db.prepare(
      "SELECT operation_id FROM idempotency_keys WHERE idempotency_key = ? AND params_hash = ?"
    ).get(idempotencyKey, paramsHash) as { operation_id: string } | undefined;

    if (!row) return undefined;
    return this.getOperation(row.operation_id);
  }

  /**
   * Find any operation with the same idempotency key but different params hash.
   * Used for IDEMPOTENCY_CONFLICT detection.
   */
  findIdempotencyConflict(idempotencyKey: string, paramsHash: string): JournalOperationRow | undefined {
    const row = this.db.prepare(
      "SELECT operation_id FROM idempotency_keys WHERE idempotency_key = ? AND params_hash != ? LIMIT 1"
    ).get(idempotencyKey, paramsHash) as { operation_id: string } | undefined;

    if (!row) return undefined;
    return this.getOperation(row.operation_id);
  }

  /**
   * Delete an operation and all related records (idempotency key, results, receipts, locks).
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

  /**
   * Get all operations in a given state.
   */
  getOperationsByState(state: OperationState): JournalOperationRow[] {
    return this.db.prepare(
      "SELECT * FROM operations WHERE state = ? ORDER BY created_at ASC"
    ).all(state) as JournalOperationRow[];
  }

  /**
   * Get total operation count.
   */
  getOperationCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM operations").get() as { count: number };
    return row.count;
  }

  // ── Operation Results (compact Circle CLI output) ────────────────────

  /**
   * Store compact Circle CLI result for idempotent replay.
   */
  storeResult(operationId: string, result: { stdout?: string; stderr?: string; json?: unknown; exitCode?: number }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO operation_results (operation_id, stdout, stderr, json_data, exit_code)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      operationId,
      result.stdout ?? null,
      result.stderr ?? null,
      result.json ? JSON.stringify(result.json) : null,
      result.exitCode ?? null,
    );
  }

  /**
   * Get stored result for idempotent replay.
   */
  getResult(operationId: string): JournalResultRow | undefined {
    return this.db.prepare(
      "SELECT * FROM operation_results WHERE operation_id = ?"
    ).get(operationId) as JournalResultRow | undefined;
  }

  // ── Receipt Proof Metadata ───────────────────────────────────────────

  /**
   * Store receipt proof metadata.
   */
  storeReceipt(operationId: string, receipt: { receiptId?: string; receiptHash?: string; proofKind?: string; proofData?: unknown }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO operation_receipts (operation_id, receipt_id, receipt_hash, proof_kind, proof_data)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      operationId,
      receipt.receiptId ?? null,
      receipt.receiptHash ?? null,
      receipt.proofKind ?? null,
      receipt.proofData ? JSON.stringify(receipt.proofData) : null,
    );
  }

  /**
   * Get stored receipt proof metadata.
   */
  getReceipt(operationId: string): JournalReceiptRow | undefined {
    return this.db.prepare(
      "SELECT * FROM operation_receipts WHERE operation_id = ?"
    ).get(operationId) as JournalReceiptRow | undefined;
  }

  // ── Wallet Locks ─────────────────────────────────────────────────────

  /**
   * Acquire a wallet lock. Returns true if acquired, false if already held.
   */
  acquireWalletLock(walletAddress: string, operationId: string): boolean {
    try {
      this.db.prepare(`
        INSERT INTO wallet_locks (wallet_address, operation_id) VALUES (?, ?)
      `).run(walletAddress.toLowerCase(), operationId);
      return true;
    } catch (err: any) {
      if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") return false;
      throw err;
    }
  }

  /**
   * Release a wallet lock.
   */
  releaseWalletLock(walletAddress: string): void {
    this.db.prepare("DELETE FROM wallet_locks WHERE wallet_address = ?").run(walletAddress.toLowerCase());
  }

  /**
   * Check if a wallet lock is held.
   */
  hasWalletLock(walletAddress: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM wallet_locks WHERE wallet_address = ?"
    ).get(walletAddress.toLowerCase());
    return !!row;
  }

  /**
   * Get the operation holding a wallet lock.
   */
  getWalletLockOperation(walletAddress: string): string | undefined {
    const row = this.db.prepare(
      "SELECT operation_id FROM wallet_locks WHERE wallet_address = ?"
    ).get(walletAddress.toLowerCase()) as { operation_id: string } | undefined;
    return row?.operation_id;
  }

  // ── Job Locks ────────────────────────────────────────────────────────

  /**
   * Acquire a job lock. Returns true if acquired, false if already held.
   */
  acquireJobLock(jobId: string, operationId: string): boolean {
    try {
      this.db.prepare(`
        INSERT INTO job_locks (job_id, operation_id) VALUES (?, ?)
      `).run(jobId, operationId);
      return true;
    } catch (err: any) {
      if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") return false;
      throw err;
    }
  }

  /**
   * Release a job lock.
   */
  releaseJobLock(jobId: string): void {
    this.db.prepare("DELETE FROM job_locks WHERE job_id = ?").run(jobId);
  }

  /**
   * Check if a job lock is held.
   */
  hasJobLock(jobId: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM job_locks WHERE job_id = ?"
    ).get(jobId);
    return !!row;
  }

  /**
   * Get the operation holding a job lock.
   */
  getJobLockOperation(jobId: string): string | undefined {
    const row = this.db.prepare(
      "SELECT operation_id FROM job_locks WHERE job_id = ?"
    ).get(jobId) as { operation_id: string } | undefined;
    return row?.operation_id;
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
   * Used during startup reconciliation.
   */
  reconcileOperation(
    operationId: string,
    outcome: "confirmed" | "failed" | "unknown",
    details?: { txHash?: string; errorCode?: OperationErrorCode; errorMessage?: string }
  ): void {
    const txn = this.db.transaction(() => {
      const updates: {
        state?: OperationState;
        txHash?: string;
        errorCode?: OperationErrorCode;
        errorMessage?: string;
      } = { state: outcome };

      if (details?.txHash) updates.txHash = details.txHash;
      if (details?.errorCode) updates.errorCode = details.errorCode;
      if (details?.errorMessage) updates.errorMessage = details.errorMessage;

      this.updateOperation(operationId, updates);

      // Release locks for terminal states
      if (outcome === "confirmed" || outcome === "failed") {
        this.releaseLocksForOperation(operationId);
      }
    });

    txn();
  }

  // ── Lock Release Helpers ─────────────────────────────────────────────

  /**
   * Release all locks held by an operation.
   */
  releaseLocksForOperation(operationId: string): void {
    this.db.prepare("DELETE FROM wallet_locks WHERE operation_id = ?").run(operationId);
    this.db.prepare("DELETE FROM job_locks WHERE operation_id = ?").run(operationId);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  /**
   * Run inside a transaction.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
