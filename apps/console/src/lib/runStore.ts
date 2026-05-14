/**
 * Off-chain agent run state.
 *
 * On-chain JobEscrow already tracks: jobId, payer, amount, status (Created→Funded→Submitted→Settled).
 * This store only persists the bits the contract DOESN'T know about:
 *   - Agent execution status (queued/running/completed/failed)
 *   - Input prompt
 *   - Output text
 *   - Error message on failure
 *
 * Idempotency: payment_tx_hash is the natural anti-replay key. UNIQUE constraint
 * means a retried POST /run with the same X-PAYMENT returns the cached run.
 */
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

const DB_PATH = process.env.ARCLAYER_RUNS_DB || '/var/lib/arclayer/runs.db';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completed'        // LLM finished, deliverable not yet on chain
  | 'submitting'       // pinning + sending submitDeliverable tx in flight
  | 'submitted'        // submitDeliverable mined OK on Arc
  | 'submit_failed'    // pinning or tx failed (output is still kept)
  | 'failed';          // LLM execution itself failed

export type AgentRun = {
  id: string;
  jobId: string;
  agentId: string;
  payer: string;
  amount: string;
  paymentTxHash: string;
  status: RunStatus;
  input: string | null;
  output: string | null;
  errorMessage: string | null;
  createdAt: number;
  completedAt: number | null;
  // B2 — on-chain submission
  deliverableCid: string | null;
  deliverableUri: string | null;
  deliverableHash: string | null;   // keccak256 over canonical deliverable JSON
  proofCid: string | null;
  proofUri: string | null;
  submitTxHash: string | null;
  submittedAt: number | null;
};

type Row = {
  id: string;
  job_id: string;
  agent_id: string;
  payer: string;
  amount: string;
  payment_tx_hash: string;
  status: RunStatus;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
  created_at: number;
  completed_at: number | null;
  deliverable_cid: string | null;
  deliverable_uri: string | null;
  deliverable_hash: string | null;
  proof_cid: string | null;
  proof_uri: string | null;
  submit_tx_hash: string | null;
  submitted_at: number | null;
};

let dbInstance: DatabaseSync | null = null;
let stmts: {
  insert: StatementSync;
  markRunning: StatementSync;
  markCompleted: StatementSync;
  markFailed: StatementSync;
  markSubmitting: StatementSync;
  markSubmitted: StatementSync;
  markSubmitFailed: StatementSync;
  getById: StatementSync;
  getByTxHash: StatementSync;
  listByJob: StatementSync;
  listByAgent: StatementSync;
} | null = null;

/**
 * Idempotent column add — node:sqlite throws if a column already exists, so
 * we probe the schema with PRAGMA before issuing ALTER TABLE.
 */
function ensureColumn(db: DatabaseSync, table: string, column: string, def: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

function getDb() {
  if (dbInstance) return { db: dbInstance, stmts: stmts! };

  if (!existsSync(dirname(DB_PATH))) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      payer TEXT NOT NULL,
      amount TEXT NOT NULL,
      payment_tx_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_runs_job ON agent_runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_runs_payer ON agent_runs(payer);
  `);

  // B2 migrations — additive only, safe to re-run.
  ensureColumn(db, 'agent_runs', 'deliverable_cid', 'TEXT');
  ensureColumn(db, 'agent_runs', 'deliverable_uri', 'TEXT');
  ensureColumn(db, 'agent_runs', 'deliverable_hash', 'TEXT');
  ensureColumn(db, 'agent_runs', 'proof_cid', 'TEXT');
  ensureColumn(db, 'agent_runs', 'proof_uri', 'TEXT');
  ensureColumn(db, 'agent_runs', 'submit_tx_hash', 'TEXT');
  ensureColumn(db, 'agent_runs', 'submitted_at', 'INTEGER');

  stmts = {
    insert: db.prepare(`
      INSERT INTO agent_runs
        (id, job_id, agent_id, payer, amount, payment_tx_hash, status, input_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)
    `),
    markRunning: db.prepare(`UPDATE agent_runs SET status='running' WHERE id=?`),
    markCompleted: db.prepare(`
      UPDATE agent_runs
         SET status='completed', output_json=?, completed_at=?
       WHERE id=?
    `),
    markFailed: db.prepare(`
      UPDATE agent_runs
         SET status='failed', error_message=?, completed_at=?
       WHERE id=?
    `),
    markSubmitting: db.prepare(`UPDATE agent_runs SET status='submitting' WHERE id=?`),
    markSubmitted: db.prepare(`
      UPDATE agent_runs
         SET status='submitted',
             deliverable_cid=?,
             deliverable_uri=?,
             deliverable_hash=?,
             proof_cid=?,
             proof_uri=?,
             submit_tx_hash=?,
             submitted_at=?
       WHERE id=?
    `),
    markSubmitFailed: db.prepare(`
      UPDATE agent_runs
         SET status='submit_failed',
             error_message=?
       WHERE id=?
    `),
    getById: db.prepare(`SELECT * FROM agent_runs WHERE id=?`),
    getByTxHash: db.prepare(`SELECT * FROM agent_runs WHERE payment_tx_hash=?`),
    listByJob: db.prepare(`SELECT * FROM agent_runs WHERE job_id=? ORDER BY created_at DESC`),
    listByAgent: db.prepare(`SELECT * FROM agent_runs WHERE agent_id=? ORDER BY created_at DESC LIMIT 100`),
  };

  dbInstance = db;
  return { db, stmts };
}

function rowToRun(row: Row): AgentRun {
  return {
    id: row.id,
    jobId: row.job_id,
    agentId: row.agent_id,
    payer: row.payer,
    amount: row.amount,
    paymentTxHash: row.payment_tx_hash,
    status: row.status,
    input: row.input_json,
    output: row.output_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    deliverableCid: row.deliverable_cid,
    deliverableUri: row.deliverable_uri,
    deliverableHash: row.deliverable_hash,
    proofCid: row.proof_cid,
    proofUri: row.proof_uri,
    submitTxHash: row.submit_tx_hash,
    submittedAt: row.submitted_at,
  };
}

export function createRun(params: {
  jobId: string;
  agentId: string;
  payer: string;
  amount: string;
  paymentTxHash: string;
  input: string | null;
}): AgentRun {
  const { stmts } = getDb();
  // Use payment_tx_hash (lowercased) as id — natural idempotency key.
  const id = params.paymentTxHash.toLowerCase();
  const now = Date.now();
  stmts.insert.run(
    id,
    params.jobId,
    params.agentId,
    params.payer.toLowerCase(),
    params.amount,
    id,
    params.input ?? null,
    now
  );
  return rowToRun(stmts.getById.get(id) as Row);
}

export function markCompleted(id: string, output: string): AgentRun {
  const { stmts } = getDb();
  stmts.markCompleted.run(output, Date.now(), id);
  return rowToRun(stmts.getById.get(id) as Row);
}

export function markFailed(id: string, errorMessage: string): AgentRun {
  const { stmts } = getDb();
  stmts.markFailed.run(errorMessage, Date.now(), id);
  return rowToRun(stmts.getById.get(id) as Row);
}

export function getRunById(id: string): AgentRun | null {
  const { stmts } = getDb();
  const row = stmts.getById.get(id.toLowerCase()) as Row | undefined;
  return row ? rowToRun(row) : null;
}

export function getRunByTxHash(txHash: string): AgentRun | null {
  const { stmts } = getDb();
  const row = stmts.getByTxHash.get(txHash.toLowerCase()) as Row | undefined;
  return row ? rowToRun(row) : null;
}

export function listRunsByJob(jobId: string): AgentRun[] {
  const { stmts } = getDb();
  return (stmts.listByJob.all(jobId) as Row[]).map(rowToRun);
}

export function listRunsByAgent(agentId: string): AgentRun[] {
  const { stmts } = getDb();
  return (stmts.listByAgent.all(agentId) as Row[]).map(rowToRun);
}

/**
 * Transition a completed run into the on-chain submission flow.
 * Caller must hold a row with status='completed' and an output_json present.
 */
export function markSubmitting(id: string): AgentRun {
  const { stmts } = getDb();
  stmts.markSubmitting.run(id);
  return rowToRun(stmts.getById.get(id) as Row);
}

/**
 * Persist the on-chain submission proof. Called after submitDeliverable
 * tx receipt is mined successfully.
 */
export function markSubmitted(
  id: string,
  args: {
    deliverableCid: string;
    deliverableUri: string;
    deliverableHash: string;
    proofCid: string;
    proofUri: string;
    submitTxHash: string;
  }
): AgentRun {
  const { stmts } = getDb();
  stmts.markSubmitted.run(
    args.deliverableCid,
    args.deliverableUri,
    args.deliverableHash,
    args.proofCid,
    args.proofUri,
    args.submitTxHash,
    Date.now(),
    id
  );
  return rowToRun(stmts.getById.get(id) as Row);
}

/**
 * Mark a run as having failed during the submit step (pinning or tx).
 * The agent output is preserved so a later /submit retry can re-pin
 * and re-send without re-running the LLM.
 */
export function markSubmitFailed(id: string, errorMessage: string): AgentRun {
  const { stmts } = getDb();
  stmts.markSubmitFailed.run(errorMessage, id);
  return rowToRun(stmts.getById.get(id) as Row);
}
