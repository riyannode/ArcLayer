/**
 * Provider Inbox — lightweight job queue for ERC-8183 provider agents.
 *
 * Instead of scanning all active jobs every cycle, providers claim one
 * actionable item at a time from the inbox. The inbox is populated by
 * the indexer event sync and acts as a fast-path queue — the indexer
 * remains the source of truth.
 */
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// ── Types ────────────────────────────────────────────────────────────────

export type InboxAction = "set_budget" | "run_and_submit" | "observe" | "skip";
export type InboxStatus = "pending" | "claimed" | "completed" | "failed" | "expired" | "stale";
export type InboxEventKind = "JobCreated" | "JobFunded" | "JobSubmitted" | "JobCompleted" | "JobRejected" | "JobExpired";

export type ProviderInboxItem = {
  id: string;
  providerWallet: string;
  agentId?: string;
  jobId: string;
  eventKind: InboxEventKind;
  action: InboxAction;
  status: InboxStatus;
  priority: number;
  txHash?: string;
  logIndex?: number;
  blockNumber?: number;
  leaseId?: string;
  lockedBy?: string;
  lockedAt?: string;
  retryAfter?: string;
  payloadJson?: unknown;
  resultJson?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  expiryAt: string;
};

// ── Schema ───────────────────────────────────────────────────────────────

export function initInboxTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_inbox (
      id TEXT PRIMARY KEY,
      provider_wallet TEXT NOT NULL,
      agent_id TEXT,
      job_id TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 50,
      tx_hash TEXT,
      log_index INTEGER,
      block_number INTEGER,
      lease_id TEXT,
      locked_by TEXT,
      locked_at TEXT,
      retry_after TEXT,
      payload_json TEXT,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expiry_at TEXT NOT NULL
    );
  `);

  for (const stmt of [
    `CREATE INDEX IF NOT EXISTS idx_inbox_provider_status ON provider_inbox(provider_wallet, status)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_claim ON provider_inbox(provider_wallet, status, priority DESC, created_at ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_job_action ON provider_inbox(provider_wallet, job_id, action)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_event_dedup ON provider_inbox(tx_hash, log_index, event_kind)`,
  ]) {
    try { db.exec(stmt); } catch { /* already exists */ }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function nowISO(): string {
  return new Date().toISOString();
}

function defaultExpiry(jobExpiredAt?: string): string {
  if (jobExpiredAt) {
    const ts = Number(jobExpiredAt);
    if (Number.isFinite(ts) && ts > 0) {
      // block timestamp → ms (if < 10B, treat as seconds)
      const ms = ts > 10_000_000_000 ? ts : ts * 1000;
      return new Date(ms).toISOString();
    }
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function rowToItem(row: Record<string, unknown>): ProviderInboxItem {
  return {
    id: row.id as string,
    providerWallet: row.provider_wallet as string,
    agentId: (row.agent_id as string) || undefined,
    jobId: row.job_id as string,
    eventKind: row.event_kind as InboxEventKind,
    action: row.action as InboxAction,
    status: row.status as InboxStatus,
    priority: Number(row.priority),
    txHash: (row.tx_hash as string) || undefined,
    logIndex: row.log_index != null ? Number(row.log_index) : undefined,
    blockNumber: row.block_number != null ? Number(row.block_number) : undefined,
    leaseId: (row.lease_id as string) || undefined,
    lockedBy: (row.locked_by as string) || undefined,
    lockedAt: (row.locked_at as string) || undefined,
    retryAfter: (row.retry_after as string) || undefined,
    payloadJson: row.payload_json ? JSON.parse(row.payload_json as string) : undefined,
    resultJson: row.result_json ? JSON.parse(row.result_json as string) : undefined,
    error: (row.error as string) || undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    expiryAt: row.expiry_at as string,
  };
}

// ── Enqueue ──────────────────────────────────────────────────────────────

export function enqueueFromEvents(
  db: DatabaseSync,
  events: Array<{
    eventName: string;
    jobId?: string | bigint;
    provider?: string;
    client?: string;
    evaluator?: string;
    transactionHash?: string;
    logIndex?: number;
    blockNumber?: string | bigint;
    expiredAt?: string | bigint;
    budget?: string | bigint;
    description?: string;
  }>,
): number {
  const now = nowISO();
  let enqueued = 0;

  const upsert = db.prepare(`
    INSERT INTO provider_inbox (
      id, provider_wallet, agent_id, job_id, event_kind, action, status, priority,
      tx_hash, log_index, block_number, payload_json, created_at, updated_at, expiry_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at = excluded.updated_at
  `);

  const markStaleStmt = db.prepare(`
    UPDATE provider_inbox
    SET status = 'stale', updated_at = ?, error = ?
    WHERE provider_wallet = ? AND job_id = ? AND status IN ('pending', 'claimed')
  `);

  for (const event of events) {
    const jobId = String(event.jobId ?? "");
    if (!jobId || jobId === "0") continue;

    const provider = (event.provider ?? "").toLowerCase();
    if (!provider || provider === "0x0000000000000000000000000000000000000000") continue;

    const expiredAt = event.expiredAt ? String(event.expiredAt) : undefined;
    const txHash = event.transactionHash;
    const logIndex = event.logIndex;
    const blockNumber = event.blockNumber ? Number(event.blockNumber) : undefined;

    // Dedup key: provider + job + eventKind
    const dedupId = `${provider}:${jobId}:${event.eventName}`;

    // TX-level dedup
    let txDedupOk = true;
    if (txHash && logIndex != null) {
      const existing = db.prepare(
        `SELECT id FROM provider_inbox WHERE tx_hash = ? AND log_index = ? AND event_kind = ?`
      ).get(txHash, logIndex, event.eventName);
      if (existing) txDedupOk = false;
    }

    if (!txDedupOk) continue;

    switch (event.eventName) {
      case "JobCreated": {
        // Only enqueue set_budget if no budget set
        const budget = event.budget ? BigInt(event.budget) : 0n;
        if (budget > 0n) break; // budget already in create
        upsert.run(
          dedupId, provider, null, jobId, 'JobCreated', 'set_budget', 'pending', 50,
          txHash ?? null, logIndex ?? null, blockNumber ?? null,
          JSON.stringify({ jobId, provider, description: event.description ?? "" }),
          now, now, defaultExpiry(expiredAt),
        );
        enqueued++;
        break;
      }
      case "JobFunded": {
        // Mark any set_budget items for this job as stale
        markStaleStmt.run(now, 'superseded by JobFunded', provider, jobId);
        // Enqueue run_and_submit at high priority
        upsert.run(
          dedupId, provider, null, jobId, 'JobFunded', 'run_and_submit', 'pending', 100,
          txHash ?? null, logIndex ?? null, blockNumber ?? null,
          JSON.stringify({ jobId, provider }),
          now, now, defaultExpiry(expiredAt),
        );
        enqueued++;
        break;
      }
      case "JobSubmitted":
      case "JobCompleted":
      case "JobRejected":
      case "JobExpired": {
        // Terminal — mark all pending/claimed for this job as stale
        markStaleStmt.run(now, `terminal: ${event.eventName}`, provider, jobId);
        break;
      }
    }
  }

  return enqueued;
}

// ── Claim ────────────────────────────────────────────────────────────────

export type ClaimInput = {
  provider: string;
  agentId?: string;
  limit?: number;
  leaseMs?: number;
  waitMs?: number;
};

export type ClaimResult = {
  ok: boolean;
  item?: ProviderInboxItem;
  waited?: number;
};

function tryClaimOnce(
  db: DatabaseSync,
  provider: string,
  limit: number,
  leaseMs: number,
  agentId?: string,
): ClaimResult {
  const now = nowISO();

  // Expire stale claims first
  db.prepare(`
    UPDATE provider_inbox
    SET status = 'pending', lease_id = NULL, locked_by = NULL, locked_at = NULL, updated_at = ?
    WHERE provider_wallet = ? AND status = 'claimed' AND expiry_at < ?
  `).run(now, provider, now);

  // Find highest-priority pending item
  const row = db.prepare(`
    SELECT * FROM provider_inbox
    WHERE provider_wallet = ? AND status = 'pending' AND expiry_at > ?
    ORDER BY priority DESC, created_at ASC
    LIMIT ?
  `).get(provider, now, limit) as Record<string, unknown> | undefined;

  if (!row) return { ok: false };

  const leaseId = randomUUID();
  const leaseExpiry = new Date(Date.now() + leaseMs).toISOString();
  const itemExpiry = row.expiry_at as string;
  // Use the sooner of lease expiry or item expiry
  const effectiveExpiry = new Date(leaseExpiry) < new Date(itemExpiry) ? leaseExpiry : itemExpiry;

  db.prepare(`
    UPDATE provider_inbox
    SET status = 'claimed', lease_id = ?, locked_by = ?, locked_at = ?, updated_at = ?, expiry_at = ?
    WHERE id = ?
  `).run(leaseId, agentId ?? provider, now, now, effectiveExpiry, row.id as string);

  const item = rowToItem({ ...row, status: "claimed", lease_id: leaseId, locked_by: agentId ?? provider, locked_at: now, updated_at: now, expiry_at: effectiveExpiry });
  return { ok: true, item };
}

export async function claimInboxItem(
  db: DatabaseSync,
  input: ClaimInput,
): Promise<ClaimResult> {
  const provider = input.provider.toLowerCase();
  const limit = Math.min(input.limit ?? 1, 1);
  const leaseMs = Math.max(input.leaseMs ?? 120_000, 30_000);
  const waitMs = Math.min(Math.max(input.waitMs ?? 0, 0), 60_000);

  // First attempt (synchronous)
  const firstAttempt = tryClaimOnce(db, provider, limit, leaseMs, input.agentId);
  if (firstAttempt.ok || waitMs <= 0) return firstAttempt;

  // Long-poll: check every 1000ms up to waitMs
  const deadline = Date.now() + waitMs;
  let waited = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    waited += 1000;
    const attempt = tryClaimOnce(db, provider, limit, leaseMs, input.agentId);
    if (attempt.ok) {
      return { ...attempt, waited };
    }
  }

  return { ok: false, waited };
}

// ── Complete ─────────────────────────────────────────────────────────────

export function completeInboxItem(
  db: DatabaseSync,
  id: string,
  leaseId: string,
  result?: Record<string, unknown>,
): { ok: boolean; error?: string } {
  const row = db.prepare(`SELECT lease_id, status FROM provider_inbox WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, error: "not found" };
  if (row.status !== "claimed") return { ok: false, error: `status is ${row.status}, not claimed` };
  if (row.lease_id !== leaseId) return { ok: false, error: "lease mismatch" };

  db.prepare(`
    UPDATE provider_inbox
    SET status = 'completed', result_json = ?, updated_at = ?, lease_id = NULL, locked_by = NULL, locked_at = NULL
    WHERE id = ?
  `).run(result ? JSON.stringify(result) : null, nowISO(), id);

  return { ok: true };
}

// ── Fail ─────────────────────────────────────────────────────────────────

export function failInboxItem(
  db: DatabaseSync,
  id: string,
  leaseId: string,
  errorMsg: string,
  retryAfterMs?: number,
): { ok: boolean; error?: string } {
  const row = db.prepare(`SELECT lease_id, status FROM provider_inbox WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, error: "not found" };
  if (row.status !== "claimed") return { ok: false, error: `status is ${row.status}, not claimed` };
  if (row.lease_id !== leaseId) return { ok: false, error: "lease mismatch" };

  if (retryAfterMs && retryAfterMs > 0) {
    // Recoverable — reset to pending with retryAfter
    const retryAfter = new Date(Date.now() + retryAfterMs).toISOString();
    db.prepare(`
      UPDATE provider_inbox
      SET status = 'pending', error = ?, retry_after = ?, updated_at = ?,
          lease_id = NULL, locked_by = NULL, locked_at = NULL
      WHERE id = ?
    `).run(errorMsg, retryAfter, nowISO(), id);
  } else {
    // Permanent failure
    db.prepare(`
      UPDATE provider_inbox
      SET status = 'failed', error = ?, updated_at = ?,
          lease_id = NULL, locked_by = NULL, locked_at = NULL
      WHERE id = ?
    `).run(errorMsg, nowISO(), id);
  }

  return { ok: true };
}

// ── Reconcile from indexer state ─────────────────────────────────────────

export function reconcileFromIndexer(
  db: DatabaseSync,
  providerWallet: string,
): { enqueued: number; staleMarked: number } {
  const now = nowISO();
  const provider = providerWallet.toLowerCase();
  let enqueued = 0;
  let staleMarked = 0;

  // Get all jobs for this provider from the jobs table
  const jobs = db.prepare(`
    SELECT id, status, budget, funded_amount, worker FROM jobs WHERE LOWER(worker) = ?
  `).all(provider) as Array<Record<string, unknown>>;

  for (const job of jobs) {
    const jobId = job.id as string;
    const status = Number(job.status);
    const budget = BigInt((job.budget as string) || "0");

    // Terminal statuses — mark inbox items stale
    if (status >= 2) {
      const changed = db.prepare(`
        UPDATE provider_inbox
        SET status = 'stale', error = ?, updated_at = ?
        WHERE provider_wallet = ? AND job_id = ? AND status IN ('pending', 'claimed')
      `).run(`reconcile: status=${status}`, now, provider, jobId);
      staleMarked += changed.changes;
      continue;
    }

    // Funded (status=1) — ensure run_and_submit exists
    if (status === 1) {
      const existing = db.prepare(`
        SELECT id FROM provider_inbox
        WHERE provider_wallet = ? AND job_id = ? AND action = 'run_and_submit' AND status IN ('pending', 'claimed')
      `).get(provider, jobId);
      if (!existing) {
        const dedupId = `${provider}:${jobId}:reconcile:JobFunded`;
        db.prepare(`
          INSERT INTO provider_inbox (
            id, provider_wallet, job_id, event_kind, action, status, priority,
            payload_json, created_at, updated_at, expiry_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(dedupId, provider, jobId, 'JobFunded', 'run_and_submit', 'pending', 100,
          JSON.stringify({ jobId, provider, source: "reconcile" }),
          now, now, defaultExpiry());
        enqueued++;
      }
      // Mark set_budget stale if exists
      const staleBudget = db.prepare(`
        UPDATE provider_inbox
        SET status = 'stale', error = 'reconcile: job already funded', updated_at = ?
        WHERE provider_wallet = ? AND job_id = ? AND action = 'set_budget' AND status IN ('pending', 'claimed')
      `).run(now, provider, jobId);
      staleMarked += staleBudget.changes;
      continue;
    }

    // Open (status=0) — ensure set_budget exists if no budget
    if (status === 0 && budget === 0n) {
      const existing = db.prepare(`
        SELECT id FROM provider_inbox
        WHERE provider_wallet = ? AND job_id = ? AND action = 'set_budget' AND status IN ('pending', 'claimed')
      `).get(provider, jobId);
      if (!existing) {
        const dedupId = `${provider}:${jobId}:reconcile:JobCreated`;
        db.prepare(`
          INSERT INTO provider_inbox (
            id, provider_wallet, job_id, event_kind, action, status, priority,
            payload_json, created_at, updated_at, expiry_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(dedupId, provider, jobId, 'JobCreated', 'set_budget', 'pending', 50,
          JSON.stringify({ jobId, provider, source: "reconcile" }),
          now, now, defaultExpiry());
        enqueued++;
      }
    }
  }

  return { enqueued, staleMarked };
}

// ── Stats ────────────────────────────────────────────────────────────────

export function readInboxStats(
  db: DatabaseSync,
  providerWallet: string,
): Record<string, number> {
  const provider = providerWallet.toLowerCase();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as cnt FROM provider_inbox
    WHERE provider_wallet = ?
    GROUP BY status
  `).all(provider) as Array<{ status: string; cnt: number }>;

  const stats: Record<string, number> = {};
  for (const row of rows) {
    stats[row.status] = row.cnt;
  }
  return stats;
}
