/**
 * AutonomyStore — durable workflow persistence for autonomous workers.
 *
 * Backed by better-sqlite3 with WAL mode, atomic lease acquisition,
 * and explicit state transition enforcement.
 *
 * Each role gets its own database file (separate data directory).
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  type AutonomyRole,
  type AutonomyWorkflow,
  type AutonomyEvent,
  type WorkflowState,
  assertStateTransition,
} from "./types";

export class AutonomyStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS autonomy_workflows (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        role TEXT NOT NULL,
        request_id TEXT,
        job_id TEXT,
        state TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        error_code TEXT,
        error_message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_run_at TEXT,
        lease_owner TEXT,
        lease_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_request
        ON autonomy_workflows(kind, request_id)
        WHERE request_id IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_job_role
        ON autonomy_workflows(kind, role, job_id)
        WHERE job_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_workflow_due
        ON autonomy_workflows(state, next_run_at);

      CREATE TABLE IF NOT EXISTS autonomy_events (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        job_id TEXT,
        role TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(workflow_id) REFERENCES autonomy_workflows(id)
      );
    `);
  }

  /**
   * Create a new workflow or return existing one (idempotent by requestId).
   */
  createOrGetWorkflow(input: {
    kind: string;
    role: AutonomyRole;
    requestId?: string;
    jobId?: string;
    state: WorkflowState;
    payload: unknown;
  }): { workflow: AutonomyWorkflow; created: boolean } {
    const now = new Date().toISOString();

    // Try to find existing by requestId
    if (input.requestId) {
      const existing = this.getByRequestId(input.kind, input.requestId);
      if (existing) {
        return { workflow: existing, created: false };
      }
    }

    // Try to find existing by jobId + role
    if (input.jobId) {
      const existing = this.getByJob(input.kind, input.role, input.jobId);
      if (existing) {
        return { workflow: existing, created: false };
      }
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO autonomy_workflows (id, kind, role, request_id, job_id, state, payload_json, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      input.kind,
      input.role,
      input.requestId ?? null,
      input.jobId ?? null,
      input.state,
      JSON.stringify(input.payload),
      now,
      now
    );

    return { workflow: this.getWorkflow(id)!, created: true };
  }

  /**
   * Get a workflow by ID.
   */
  getWorkflow(id: string): AutonomyWorkflow | null {
    const row = this.db.prepare("SELECT * FROM autonomy_workflows WHERE id = ?").get(id) as any;
    return row ? this.rowToWorkflow(row) : null;
  }

  /**
   * Get a workflow by kind + requestId.
   */
  getByRequestId(kind: string, requestId: string): AutonomyWorkflow | null {
    const row = this.db.prepare(
      "SELECT * FROM autonomy_workflows WHERE kind = ? AND request_id = ?"
    ).get(kind, requestId) as any;
    return row ? this.rowToWorkflow(row) : null;
  }

  /**
   * Get a workflow by kind + role + jobId.
   */
  getByJob(kind: string, role: AutonomyRole, jobId: string): AutonomyWorkflow | null {
    const row = this.db.prepare(
      "SELECT * FROM autonomy_workflows WHERE kind = ? AND role = ? AND job_id = ?"
    ).get(kind, role, jobId) as any;
    return row ? this.rowToWorkflow(row) : null;
  }

  /**
   * Transition a workflow to a new state. Throws on illegal transition.
   */
  transition(
    id: string,
    to: WorkflowState,
    result?: unknown,
    options?: { errorCode?: string; errorMessage?: string }
  ): AutonomyWorkflow {
    const workflow = this.getWorkflow(id);
    if (!workflow) throw new Error(`Workflow not found: ${id}`);

    assertStateTransition(workflow.role, workflow.state, to);

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE autonomy_workflows
      SET state = ?, result_json = ?, error_code = ?, error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      to,
      result ? JSON.stringify(result) : null,
      options?.errorCode ?? null,
      options?.errorMessage ?? null,
      now,
      id
    );

    return this.getWorkflow(id)!;
  }

  /**
   * Record a failure attempt and optionally schedule retry.
   */
  recordFailure(
    id: string,
    errorCode: string,
    errorMessage: string,
    retryable: boolean
  ): AutonomyWorkflow {
    const workflow = this.getWorkflow(id);
    if (!workflow) throw new Error(`Workflow not found: ${id}`);

    const now = new Date().toISOString();
    const newState = retryable ? "FAILED_RETRYABLE" : "FAILED_FINAL";

    this.db.prepare(`
      UPDATE autonomy_workflows
      SET state = ?, error_code = ?, error_message = ?, attempts = attempts + 1, updated_at = ?
      WHERE id = ?
    `).run(newState, errorCode, errorMessage, now, id);

    return this.getWorkflow(id)!;
  }

  /**
   * Schedule a retry with exponential backoff.
   * attempt 1: 5s, attempt 2: 15s, attempt 3: 60s
   */
  scheduleRetry(id: string): AutonomyWorkflow {
    const workflow = this.getWorkflow(id);
    if (!workflow) throw new Error(`Workflow not found: ${id}`);

    const backoffMs = [5000, 15000, 60000][Math.min(workflow.attempts, 2)];
    const nextRun = new Date(Date.now() + backoffMs).toISOString();

    this.db.prepare(`
      UPDATE autonomy_workflows
      SET next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nextRun, new Date().toISOString(), id);

    return this.getWorkflow(id)!;
  }

  /**
   * Atomically claim a due workflow for execution.
   * Uses a transaction to prevent two workers from claiming the same workflow.
   */
  claimDueWorkflow(
    kind: string,
    role: AutonomyRole,
    leaseOwner: string,
    leaseMs: number
  ): AutonomyWorkflow | null {
    const now = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + leaseMs).toISOString();

    const claimed = this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM autonomy_workflows
        WHERE kind = ? AND role = ?
          AND state IN ('RECEIVED', 'DISCOVERED', 'FAILED_RETRYABLE', 'VALIDATING', 'VERIFYING')
          AND (lease_until IS NULL OR lease_until < ?)
          AND (next_run_at IS NULL OR next_run_at <= ?)
        ORDER BY created_at ASC
        LIMIT 1
      `).get(kind, role, now, now) as any;

      if (!row) return null;

      this.db.prepare(`
        UPDATE autonomy_workflows
        SET lease_owner = ?, lease_until = ?, updated_at = ?
        WHERE id = ?
      `).run(leaseOwner, leaseUntil, now, row.id);

      return this.rowToWorkflow(row);
    })();

    return claimed;
  }

  /**
   * Renew a lease for an active workflow.
   */
  renewLease(id: string, leaseMs: number): void {
    const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
    this.db.prepare(`
      UPDATE autonomy_workflows
      SET lease_until = ?, updated_at = ?
      WHERE id = ?
    `).run(leaseUntil, new Date().toISOString(), id);
  }

  /**
   * Release a lease (workflow finished or failed).
   */
  releaseLease(id: string): void {
    this.db.prepare(`
      UPDATE autonomy_workflows
      SET lease_owner = NULL, lease_until = NULL, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id);
  }

  /**
   * Append an event to the event log.
   */
  appendEvent(input: {
    workflowId: string;
    jobId?: string;
    role: AutonomyRole;
    eventType: string;
    payload: unknown;
  }): AutonomyEvent {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO autonomy_events (id, workflow_id, job_id, role, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.workflowId, input.jobId ?? null, input.role, input.eventType, JSON.stringify(input.payload), now);

    return {
      id,
      workflowId: input.workflowId,
      jobId: input.jobId,
      role: input.role,
      eventType: input.eventType,
      payload: input.payload,
      createdAt: now,
    };
  }

  /**
   * List events for a workflow.
   */
  listEvents(workflowId: string): AutonomyEvent[] {
    const rows = this.db.prepare(
      "SELECT * FROM autonomy_events WHERE workflow_id = ? ORDER BY created_at ASC"
    ).all(workflowId) as any[];
    return rows.map((r) => ({
      id: r.id,
      workflowId: r.workflow_id,
      jobId: r.job_id ?? undefined,
      role: r.role as AutonomyRole,
      eventType: r.event_type,
      payload: JSON.parse(r.payload_json),
      createdAt: r.created_at,
    }));
  }

  /**
   * List all active (non-terminal) workflows.
   */
  listActive(kind: string, role: AutonomyRole): AutonomyWorkflow[] {
    const terminalStates = [
      "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED",
      "FAILED_FINAL", "TERMINAL_EXTERNAL", "MANUAL_REVIEW",
    ];
    const placeholders = terminalStates.map(() => "?").join(",");
    const rows = this.db.prepare(`
      SELECT * FROM autonomy_workflows
      WHERE kind = ? AND role = ? AND state NOT IN (${placeholders})
      ORDER BY created_at ASC
    `).all(kind, role, ...terminalStates) as any[];
    return rows.map((r) => this.rowToWorkflow(r));
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  private rowToWorkflow(row: any): AutonomyWorkflow {
    return {
      id: row.id,
      kind: row.kind,
      role: row.role as AutonomyRole,
      requestId: row.request_id ?? undefined,
      jobId: row.job_id ?? undefined,
      state: row.state as WorkflowState,
      payload: JSON.parse(row.payload_json),
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      errorCode: row.error_code ?? undefined,
      errorMessage: row.error_message ?? undefined,
      attempts: row.attempts,
      nextRunAt: row.next_run_at ?? undefined,
      leaseOwner: row.lease_owner ?? undefined,
      leaseUntil: row.lease_until ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
