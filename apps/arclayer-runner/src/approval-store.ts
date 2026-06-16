/**
 * ApprovalStore — SQLite-backed approval state machine for client ERC-8183 actions.
 *
 * Follows the same pattern as OperationJournal (WAL, busy_timeout, BEGIN IMMEDIATE).
 * Duplicate approve semantics:
 *   - pending: transition to executing, caller may proceed
 *   - executing: return in-progress, no new tx
 *   - executed: return existing result, no new tx
 *   - failed: return failed state (no auto-retry)
 *   - rejected/cancelled/expired: blocked
 *
 * Expiry: check-on-read and check-on-approve. No background reaper.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type ApprovalState,
  type ApprovalActionType,
  type ApprovalRecord,
  type CreateApprovalInput,
  type TransitionResult,
} from "@arclayer/runner-core";

export { computeRequestHash, type ApprovalRecord, type CreateApprovalInput, type TransitionResult } from "@arclayer/runner-core";

// ── Schema ─────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations_approval (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT    NOT NULL DEFAULT (datetime('now')),
  checksum   TEXT
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id       TEXT PRIMARY KEY,
  action_type       TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'client',
  wallet_address    TEXT NOT NULL,
  chain_id          INTEGER NOT NULL,
  job_id            TEXT,
  amount            TEXT,
  request_hash      TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  state             TEXT NOT NULL DEFAULT 'pending',
  params_json       TEXT NOT NULL,
  tx_hash           TEXT,
  result_json       TEXT,
  operation_id      TEXT,
  error_message     TEXT,
  expires_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_approvals_state ON approvals(state);
CREATE INDEX IF NOT EXISTS idx_approvals_wallet ON approvals(wallet_address);
CREATE INDEX IF NOT EXISTS idx_approvals_expires ON approvals(expires_at);
CREATE INDEX IF NOT EXISTS idx_approvals_action ON approvals(action_type);
`;

// ── Row Mapping ────────────────────────────────────────────────────────────

type ApprovalRow = {
  approval_id: string;
  action_type: string;
  role: string;
  wallet_address: string;
  chain_id: number;
  job_id: string | null;
  amount: string | null;
  request_hash: string;
  idempotency_key: string;
  state: string;
  params_json: string;
  tx_hash: string | null;
  result_json: string | null;
  operation_id: string | null;
  error_message: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

function mapRow(row: ApprovalRow): ApprovalRecord {
  return {
    approvalId: row.approval_id,
    actionType: row.action_type as ApprovalActionType,
    role: row.role,
    walletAddress: row.wallet_address,
    chainId: row.chain_id,
    jobId: row.job_id,
    amount: row.amount,
    requestHash: row.request_hash,
    idempotencyKey: row.idempotency_key,
    state: row.state as ApprovalState,
    paramsJson: row.params_json,
    txHash: row.tx_hash,
    resultJson: row.result_json,
    operationId: row.operation_id,
    errorMessage: row.error_message,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Store ──────────────────────────────────────────────────────────────────

export class ApprovalStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    this.runMigrations();
  }

  // ── Migrations ───────────────────────────────────────────────────────

  private runMigrations(): void {
    const currentVersion = this.getCurrentVersion();
    if (currentVersion >= SCHEMA_VERSION) return;

    const txn = this.db.transaction(() => {
      this.db.exec(SCHEMA_SQL);
      this.db.prepare(
        `INSERT OR IGNORE INTO schema_migrations_approval (version, checksum) VALUES (?, ?)`
      ).run(SCHEMA_VERSION, `approval-v${SCHEMA_VERSION}`);
    }).immediate;

    txn();
  }

  private getCurrentVersion(): number {
    const tableExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations_approval'"
    ).get() as { name: string } | undefined;

    if (!tableExists) return 0;

    const row = this.db.prepare(
      "SELECT MAX(version) as version FROM schema_migrations_approval"
    ).get() as { version: number | null } | undefined;

    return row?.version ?? 0;
  }

  // ── Create ───────────────────────────────────────────────────────────

  create(input: CreateApprovalInput): ApprovalRecord {
    const now = new Date().toISOString();
    const approvalId = `apr-${randomUUID()}`;

    const record: ApprovalRecord = {
      approvalId,
      actionType: input.actionType,
      role: input.role,
      walletAddress: input.walletAddress.toLowerCase(),
      chainId: input.chainId,
      jobId: input.jobId ?? null,
      amount: input.amount ?? null,
      requestHash: input.requestHash,
      idempotencyKey: input.idempotencyKey,
      state: "pending",
      paramsJson: JSON.stringify(input.params),
      txHash: null,
      resultJson: null,
      operationId: null,
      errorMessage: null,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO approvals (
        approval_id, action_type, role, wallet_address, chain_id,
        job_id, amount, request_hash, idempotency_key, state,
        params_json, tx_hash, result_json, operation_id, error_message,
        expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.approvalId,
      record.actionType,
      record.role,
      record.walletAddress,
      record.chainId,
      record.jobId,
      record.amount,
      record.requestHash,
      record.idempotencyKey,
      record.state,
      record.paramsJson,
      record.txHash,
      record.resultJson,
      record.operationId,
      record.errorMessage,
      record.expiresAt,
      record.createdAt,
      record.updatedAt,
    );

    return record;
  }

  // ── Read ─────────────────────────────────────────────────────────────

  get(approvalId: string): ApprovalRecord | undefined {
    const row = this.db.prepare(
      "SELECT * FROM approvals WHERE approval_id = ?"
    ).get(approvalId) as ApprovalRow | undefined;

    if (!row) return undefined;
    const record = mapRow(row);
    this.checkAndExpire(record);
    return record;
  }

  getByIdempotencyKey(idempotencyKey: string): ApprovalRecord | undefined {
    const row = this.db.prepare(
      "SELECT * FROM approvals WHERE idempotency_key = ?"
    ).get(idempotencyKey) as ApprovalRow | undefined;

    if (!row) return undefined;
    const record = mapRow(row);
    this.checkAndExpire(record);
    return record;
  }

  listPending(walletAddress?: string, limit = 50): ApprovalRecord[] {
    let rows: ApprovalRow[];
    if (walletAddress) {
      rows = this.db.prepare(
        "SELECT * FROM approvals WHERE state = 'pending' AND wallet_address = ? ORDER BY created_at DESC LIMIT ?"
      ).all(walletAddress.toLowerCase(), limit) as ApprovalRow[];
    } else {
      rows = this.db.prepare(
        "SELECT * FROM approvals WHERE state = 'pending' ORDER BY created_at DESC LIMIT ?"
      ).all(limit) as ApprovalRow[];
    }

    const records = rows.map(mapRow);

    // Check-on-read: expire stale pending approvals
    for (const record of records) {
      this.checkAndExpire(record);
    }

    // Filter out newly-expired ones
    return records.filter(r => r.state === "pending");
  }

  // ── Transitions ──────────────────────────────────────────────────────

  /**
   * Transition from pending → approved.
   * Used by erc8004 registration flow (approve then execute separately).
   */
  transitionToApproved(approvalId: string): TransitionResult {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE approvals
      SET state = 'approved', updated_at = ?
      WHERE approval_id = ? AND state = 'pending'
    `).run(now, approvalId);

    if (result.changes === 0) {
      const current = this.get(approvalId);
      if (!current) {
        return { ok: false, error: "APPROVAL_NOT_FOUND", current: undefined as unknown as ApprovalRecord };
      }
      return { ok: false, error: `INVALID_STATE: ${current.state}`, current };
    }

    return { ok: true, approval: this.get(approvalId)! };
  }

  /**
   * Transition from approved → executing.
   * Used by erc8004 registration flow after explicit approval.
   */
  transitionFromApprovedToExecuting(approvalId: string): TransitionResult {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE approvals
      SET state = 'executing', updated_at = ?
      WHERE approval_id = ? AND state = 'approved'
    `).run(now, approvalId);

    if (result.changes === 0) {
      const current = this.get(approvalId);
      if (!current) {
        return { ok: false, error: "APPROVAL_NOT_FOUND", current: undefined as unknown as ApprovalRecord };
      }
      return { ok: false, error: `INVALID_STATE: ${current.state}`, current };
    }

    const updated = this.get(approvalId)!;
    return { ok: true, approval: updated };
  }

  /**
   * Atomic transition from pending → executing.
   * Uses SQL WHERE state = 'pending' AND expires_at > now.
   * Does NOT hold a transaction open during execution.
   */
  transitionToExecuting(approvalId: string): TransitionResult {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE approvals
      SET state = 'executing', updated_at = ?
      WHERE approval_id = ? AND state = 'pending' AND expires_at > ?
    `).run(now, approvalId, now);

    if (result.changes === 0) {
      const current = this.get(approvalId);
      if (!current) {
        return { ok: false, error: "APPROVAL_NOT_FOUND", current: undefined as unknown as ApprovalRecord };
      }
      return { ok: false, error: `INVALID_STATE: ${current.state}`, current };
    }

    const updated = this.get(approvalId)!;
    return { ok: true, approval: updated };
  }

  /**
   * Transition from executing → executed.
   */
  transitionToExecuted(
    approvalId: string,
    txHash?: string,
    result?: unknown,
    operationId?: string
  ): ApprovalRecord {
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE approvals
      SET state = 'executed', tx_hash = ?, result_json = ?, operation_id = ?, updated_at = ?
      WHERE approval_id = ? AND state = 'executing'
    `).run(
      txHash ?? null,
      result ? JSON.stringify(result) : null,
      operationId ?? null,
      now,
      approvalId,
    );

    return this.get(approvalId)!;
  }

  /**
   * Transition from executing → failed.
   */
  transitionToFailed(approvalId: string, errorMessage: string): ApprovalRecord {
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE approvals
      SET state = 'failed', error_message = ?, updated_at = ?
      WHERE approval_id = ? AND state = 'executing'
    `).run(errorMessage.slice(0, 500), now, approvalId);

    return this.get(approvalId)!;
  }

  /**
   * Transition from pending → rejected.
   */
  transitionToRejected(approvalId: string, reason?: string): TransitionResult {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE approvals
      SET state = 'rejected', error_message = ?, updated_at = ?
      WHERE approval_id = ? AND state = 'pending'
    `).run(reason ?? null, now, approvalId);

    if (result.changes === 0) {
      const current = this.get(approvalId);
      if (!current) {
        return { ok: false, error: "APPROVAL_NOT_FOUND", current: undefined as unknown as ApprovalRecord };
      }
      return { ok: false, error: `INVALID_STATE: ${current.state}`, current };
    }

    return { ok: true, approval: this.get(approvalId)! };
  }

  /**
   * Transition from pending → cancelled.
   */
  transitionToCancelled(approvalId: string): TransitionResult {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE approvals
      SET state = 'cancelled', updated_at = ?
      WHERE approval_id = ? AND state = 'pending'
    `).run(now, approvalId);

    if (result.changes === 0) {
      const current = this.get(approvalId);
      if (!current) {
        return { ok: false, error: "APPROVAL_NOT_FOUND", current: undefined as unknown as ApprovalRecord };
      }
      return { ok: false, error: `INVALID_STATE: ${current.state}`, current };
    }

    return { ok: true, approval: this.get(approvalId)! };
  }

  // ── Expiry ───────────────────────────────────────────────────────────

  private checkAndExpire(record: ApprovalRecord): void {
    if (record.state !== "pending") return;

    const now = new Date().toISOString();
    if (record.expiresAt > now) return;

    this.db.prepare(
      "UPDATE approvals SET state = 'expired', updated_at = ? WHERE approval_id = ? AND state = 'pending'"
    ).run(now, record.approvalId);

    record.state = "expired";
    record.updatedAt = now;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  getSchemaVersion(): number {
    return this.getCurrentVersion();
  }
}
