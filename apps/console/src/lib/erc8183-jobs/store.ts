/**
 * ERC-8183 Escrow Job Store — local mirror & provider metadata operations.
 *
 * All functions operate on the shared agent_jobs table with
 * settlement_mode = 'erc8183_escrow'. No x402 calls, no private keys.
 *
 * The on-chain AgenticCommerce contract is the source of truth for
 * escrow state. This store is a local mirror for:
 *   - provider claim/running metadata
 *   - payload/result storage
 *   - tx hash history
 *   - live UI history
 */

import { createHash, randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CreateErc8183JobInput,
  Erc8183JobView,
  Erc8183Status,
} from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function ensureDb(): SupabaseClient {
  return getSupabaseAdmin();
}

// ─── Tx Hash Immutability Guard ─────────────────────────────────────────────

function normalizeTxHash(txHash: string | null | undefined): string | null {
  return txHash ? txHash.toLowerCase() : null;
}

export class Erc8183TxHashConflictError extends Error {
  code = 'TX_HASH_CONFLICT' as const;

  constructor(
    public readonly fieldName: string,
    public readonly existingTxHash: string,
    public readonly nextTxHash: string,
  ) {
    super(`${fieldName} already attached with a different tx hash`);
  }
}

export class Erc8183TxHashIdempotentError extends Error {
  code = 'IDEMPOTENT_TX' as const;

  constructor(
    public readonly fieldName: string,
    public readonly existingTxHash: string,
  ) {
    super(`${fieldName} already attached with the same tx hash`);
  }
}

function assertImmutableTxHash(params: {
  existingTxHash: string | null | undefined;
  nextTxHash: string;
  fieldName: string;
}) {
  const existing = normalizeTxHash(params.existingTxHash);
  const next = normalizeTxHash(params.nextTxHash);

  if (!existing) return;

  if (existing === next) {
    throw new Erc8183TxHashIdempotentError(params.fieldName, params.existingTxHash!);
  }

  throw new Erc8183TxHashConflictError(
    params.fieldName,
    params.existingTxHash!,
    params.nextTxHash,
  );
}

async function readTxColumn(
  db: SupabaseClient,
  localJobId: string,
  column: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('agent_jobs')
    .select(column)
    .eq('job_id', localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`readTxColumn failed for ${column}: ${error.message}`);
  }

  const row = data as unknown as Record<string, unknown> | null;
  return row?.[column] ? String(row[column]) : null;
}

function mapRow(row: Record<string, unknown>): Erc8183JobView {
  return {
    localJobId: String(row.job_id),
    erc8183JobId: row.erc8183_job_id ? String(row.erc8183_job_id) : null,
    settlementMode: 'erc8183_escrow',
    erc8183Status: row.erc8183_status ? (row.erc8183_status as Erc8183Status) : null,
    status: String(row.status),
    buyerAgentId: String(row.buyer_agent_id),
    clientAddress: row.client_address ? String(row.client_address) : null,
    providerAgentId: row.provider_agent_id ? String(row.provider_agent_id) : null,
    providerAddress: row.provider_address ? String(row.provider_address) : null,
    evaluatorAgentId: row.evaluator_agent_id ? String(row.evaluator_agent_id) : null,
    evaluatorAddress: row.evaluator_address ? String(row.evaluator_address) : null,
    workerId: row.worker_id ? String(row.worker_id) : null,
    priceAtomic: String(row.price_atomic),
    description: row.description ? String(row.description) : null,
    expiredAtUnix: row.expired_at_unix ? String(row.expired_at_unix) : null,
    hookAddress: row.hook_address ? String(row.hook_address) : null,
    inputPayload: (row.input_payload as Record<string, unknown>) ?? {},
    inputPayloadHash: String(row.input_payload_hash),
    resultPayload: row.result_payload ? (row.result_payload as Record<string, unknown>) : null,
    resultPayloadHash: row.result_payload_hash ? String(row.result_payload_hash) : null,
    proofPayload: row.proof_payload ? (row.proof_payload as Record<string, unknown>) : null,
    proofPayloadHash: row.proof_payload_hash ? String(row.proof_payload_hash) : null,
    deliverableHash: row.deliverable_hash ? String(row.deliverable_hash) : null,
    reasonHash: row.reason_hash ? String(row.reason_hash) : null,
    createTxHash: row.create_tx_hash ? String(row.create_tx_hash) : null,
    setBudgetTxHash: row.set_budget_tx_hash ? String(row.set_budget_tx_hash) : null,
    approveTxHash: row.approve_tx_hash ? String(row.approve_tx_hash) : null,
    fundTxHash: row.fund_tx_hash ? String(row.fund_tx_hash) : null,
    submitTxHash: row.submit_tx_hash ? String(row.submit_tx_hash) : null,
    completeTxHash: row.complete_tx_hash ? String(row.complete_tx_hash) : null,
    rejectTxHash: row.reject_tx_hash ? String(row.reject_tx_hash) : null,
    rejectedAt: row.rejected_at ? String(row.rejected_at) : null,
    rejectReasonText: row.reject_reason_text ? String(row.reject_reason_text) : null,
    rejectReasonHash: row.reject_reason_hash ? String(row.reject_reason_hash) : null,
    createdAt: String(row.created_at),
    claimedAt: row.claimed_at ? String(row.claimed_at) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
  };
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createLocalErc8183Job(
  input: CreateErc8183JobInput,
): Promise<Erc8183JobView> {
  const db = ensureDb();
  const jobId = `erc8183_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const inputPayloadHash = sha256Hex(stableStringify(input.inputPayload));

  const { data, error } = await db
    .from('agent_jobs')
    .insert({
      job_id: jobId,
      job_type: 'erc8183_escrow',
      settlement_mode: 'erc8183_escrow',
      status: 'created',
      buyer_agent_id: input.buyerAgentId,
      provider_agent_id: input.providerAgentId,
      client_address: input.clientAddress,
      provider_address: input.providerAddress,
      evaluator_agent_id: input.evaluatorAgentId ?? null,
      evaluator_address: input.evaluatorAddress ?? null,
      expired_at_unix: input.expiredAtUnix,
      description: input.description,
      hook_address: input.hookAddress,
      price_atomic: input.budgetAtomic,
      asset: 'USDC',
      chain_id: '5042002',
      input_payload: input.inputPayload,
      input_payload_hash: inputPayloadHash,
    })
    .select()
    .single();

  if (error) throw new Error(`createLocalErc8183Job failed: ${error.message}`);

  // Add created event (DB trigger only fires on UPDATE OF status, not INSERT)
  await db.from('agent_job_events').insert({
    job_id: jobId,
    event_type: 'created',
    actor_agent_id: input.buyerAgentId,
    status_before: null,
    status_after: 'created',
    payload_hash: inputPayloadHash,
    metadata: {
      settlement_mode: 'erc8183_escrow',
      budgetAtomic: input.budgetAtomic,
    },
  });

  return mapRow(data);
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getErc8183JobByLocalId(
  localJobId: string,
): Promise<Erc8183JobView | null> {
  const db = ensureDb();
  const { data, error } = await db
    .from('agent_jobs')
    .select('*')
    .eq('job_id', localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw new Error(`getErc8183JobByLocalId failed: ${error.message}`);
  }
  return mapRow(data);
}

export async function getErc8183JobByOnchainId(
  erc8183JobId: string,
): Promise<Erc8183JobView | null> {
  const db = ensureDb();
  const { data, error } = await db
    .from('agent_jobs')
    .select('*')
    .eq('erc8183_job_id', erc8183JobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`getErc8183JobByOnchainId failed: ${error.message}`);
  }
  return mapRow(data);
}

/**
 * List ERC-8183 escrow jobs — always filtered to settlement_mode='erc8183_escrow'.
 */
export async function listErc8183Jobs(filter: {
  buyerAgentId?: string;
  providerAgentId?: string;
  evaluatorAgentId?: string;
  workerId?: string;
  status?: string;
  erc8183Status?: Erc8183Status;
  limit?: number;
  offset?: number;
} = {}): Promise<Erc8183JobView[]> {
  const db = ensureDb();
  let query = db.from('agent_jobs').select('*');

  query = query.eq('settlement_mode', 'erc8183_escrow');
  if (filter.buyerAgentId) query = query.eq('buyer_agent_id', filter.buyerAgentId);
  if (filter.providerAgentId) query = query.eq('provider_agent_id', filter.providerAgentId);
  if (filter.evaluatorAgentId) query = query.eq('evaluator_agent_id', filter.evaluatorAgentId);
  if (filter.workerId) query = query.eq('worker_id', filter.workerId);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.erc8183Status) query = query.eq('erc8183_status', filter.erc8183Status);

  query = query.order('created_at', { ascending: false });

  const lim = filter.limit ?? 50;
  query = query.limit(lim);
  if (filter.offset) {
    query = query.range(filter.offset, filter.offset + lim - 1);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listErc8183Jobs failed: ${error.message}`);
  return (data ?? []).map(mapRow);
}

// ─── Attach tx hashes ─────────────────────────────────────────────────────────

export async function attachErc8183CreateTx(input: {
  localJobId: string;
  createTxHash: string;
  erc8183JobId: string;
}): Promise<void> {
  const db = ensureDb();
  const { error } = await db
    .from('agent_jobs')
    .update({
      create_tx_hash: input.createTxHash,
      erc8183_job_id: input.erc8183JobId,
      erc8183_status: 'Open',
    })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (error) throw new Error(`attachErc8183CreateTx failed: ${error.message}`);
}

export async function attachErc8183JobId(input: {
  localJobId: string;
  erc8183JobId: string;
}): Promise<void> {
  const db = ensureDb();
  const { error } = await db
    .from('agent_jobs')
    .update({ erc8183_job_id: input.erc8183JobId })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (error) throw new Error(`attachErc8183JobId failed: ${error.message}`);
}

export async function attachErc8183SetBudgetTx(input: {
  localJobId: string;
  setBudgetTxHash: string;
}): Promise<void> {
  const db = ensureDb();
  const field = 'set_budget_tx_hash';

  const existing = await readTxColumn(db, input.localJobId, field);

  try {
    assertImmutableTxHash({
      existingTxHash: existing,
      nextTxHash: input.setBudgetTxHash,
      fieldName: field,
    });
  } catch (err) {
    if (err instanceof Erc8183TxHashIdempotentError) return;
    throw err;
  }

  const { data: updated, error } = await db
    .from('agent_jobs')
    .update({ set_budget_tx_hash: input.setBudgetTxHash })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .is('set_budget_tx_hash', null)
    .select('job_id');

  if (error) throw new Error(`attachErc8183SetBudgetTx failed: ${error.message}`);

  if (!updated || updated.length === 0) {
    const actual = await readTxColumn(db, input.localJobId, field);
    if (actual && normalizeTxHash(actual) === normalizeTxHash(input.setBudgetTxHash)) return;
    throw new Erc8183TxHashConflictError(field, actual ?? 'unknown', input.setBudgetTxHash);
  }
}

export async function attachErc8183ApproveTx(input: {
  localJobId: string;
  approveTxHash: string;
}): Promise<void> {
  const db = ensureDb();
  const field = 'approve_tx_hash';

  const existing = await readTxColumn(db, input.localJobId, field);

  try {
    assertImmutableTxHash({
      existingTxHash: existing,
      nextTxHash: input.approveTxHash,
      fieldName: field,
    });
  } catch (err) {
    if (err instanceof Erc8183TxHashIdempotentError) return;
    throw err;
  }

  const { data: updated, error } = await db
    .from('agent_jobs')
    .update({ approve_tx_hash: input.approveTxHash })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .is('approve_tx_hash', null)
    .select('job_id');

  if (error) throw new Error(`attachErc8183ApproveTx failed: ${error.message}`);

  if (!updated || updated.length === 0) {
    const actual = await readTxColumn(db, input.localJobId, field);
    if (actual && normalizeTxHash(actual) === normalizeTxHash(input.approveTxHash)) return;
    throw new Erc8183TxHashConflictError(field, actual ?? 'unknown', input.approveTxHash);
  }
}

export async function attachErc8183FundTx(input: {
  localJobId: string;
  fundTxHash: string;
  erc8183Status: Erc8183Status;
}): Promise<void> {
  const db = ensureDb();
  const field = 'fund_tx_hash';

  const existing = await readTxColumn(db, input.localJobId, field);

  try {
    assertImmutableTxHash({
      existingTxHash: existing,
      nextTxHash: input.fundTxHash,
      fieldName: field,
    });
  } catch (err) {
    if (err instanceof Erc8183TxHashIdempotentError) return;
    throw err;
  }

  const { data: updated, error } = await db
    .from('agent_jobs')
    .update({
      fund_tx_hash: input.fundTxHash,
      erc8183_status: input.erc8183Status,
    })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .is('fund_tx_hash', null)
    .select('job_id');

  if (error) throw new Error(`attachErc8183FundTx failed: ${error.message}`);

  if (!updated || updated.length === 0) {
    const actual = await readTxColumn(db, input.localJobId, field);
    if (actual && normalizeTxHash(actual) === normalizeTxHash(input.fundTxHash)) return;
    throw new Erc8183TxHashConflictError(field, actual ?? 'unknown', input.fundTxHash);
  }
}

export async function attachErc8183SubmitTx(input: {
  localJobId: string;
  submitTxHash: string;
  erc8183Status: Erc8183Status;
  status?: string;
}): Promise<void> {
  const db = ensureDb();
  const field = 'submit_tx_hash';

  const existing = await readTxColumn(db, input.localJobId, field);

  try {
    assertImmutableTxHash({
      existingTxHash: existing,
      nextTxHash: input.submitTxHash,
      fieldName: field,
    });
  } catch (err) {
    if (err instanceof Erc8183TxHashIdempotentError) return;
    throw err;
  }

  const update: Record<string, unknown> = {
    submit_tx_hash: input.submitTxHash,
    erc8183_status: input.erc8183Status,
  };
  if (input.status) update.status = input.status;
  if (input.status === 'submitted') update.submitted_at = new Date().toISOString();

  const { data: updated, error } = await db
    .from('agent_jobs')
    .update(update)
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .is('submit_tx_hash', null)
    .select('job_id');

  if (error) throw new Error(`attachErc8183SubmitTx failed: ${error.message}`);

  if (!updated || updated.length === 0) {
    const actual = await readTxColumn(db, input.localJobId, field);
    if (actual && normalizeTxHash(actual) === normalizeTxHash(input.submitTxHash)) return;
    throw new Erc8183TxHashConflictError(field, actual ?? 'unknown', input.submitTxHash);
  }
}

export async function attachErc8183CompleteTx(input: {
  localJobId: string;
  completeTxHash: string;
  erc8183Status: Erc8183Status;
}): Promise<void> {
  const db = ensureDb();
  const field = 'complete_tx_hash';

  const existing = await readTxColumn(db, input.localJobId, field);

  try {
    assertImmutableTxHash({
      existingTxHash: existing,
      nextTxHash: input.completeTxHash,
      fieldName: field,
    });
  } catch (err) {
    if (err instanceof Erc8183TxHashIdempotentError) return;
    throw err;
  }

  const { data: updated, error } = await db
    .from('agent_jobs')
    .update({
      complete_tx_hash: input.completeTxHash,
      erc8183_status: input.erc8183Status,
      status: 'settled',
      settled_at: new Date().toISOString(),
    })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .is('complete_tx_hash', null)
    .select('job_id');

  if (error) throw new Error(`attachErc8183CompleteTx failed: ${error.message}`);

  if (!updated || updated.length === 0) {
    const actual = await readTxColumn(db, input.localJobId, field);
    if (actual && normalizeTxHash(actual) === normalizeTxHash(input.completeTxHash)) return;
    throw new Erc8183TxHashConflictError(field, actual ?? 'unknown', input.completeTxHash);
  }
}

/**
 * attachErc8183PreparedSubmit — persist result/proof/deliverable hash
 * before the submit tx is signed and broadcast.
 *
 * This ensures the local mirror has all proof data before on-chain settlement.
 */
export async function attachErc8183PreparedSubmit(input: {
  localJobId: string;
  resultPayload: Record<string, unknown>;
  resultPayloadHash: string;
  proofPayload: Record<string, unknown>;
  proofPayloadHash: string;
  deliverableHash: string;
}): Promise<void> {
  const db = ensureDb();
  const { error } = await db
    .from('agent_jobs')
    .update({
      result_payload: input.resultPayload,
      result_payload_hash: input.resultPayloadHash,
      proof_payload: input.proofPayload,
      proof_payload_hash: input.proofPayloadHash,
      deliverable_hash: input.deliverableHash,
    })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (error) throw new Error(`attachErc8183PreparedSubmit failed: ${error.message}`);
}

/**
 * attachErc8183PreparedComplete — persist reasonHash before the
 * complete tx is signed and broadcast.
 */
export async function attachErc8183PreparedComplete(input: {
  localJobId: string;
  reasonHash: string;
}): Promise<void> {
  const db = ensureDb();
  const { error } = await db
    .from('agent_jobs')
    .update({
      reason_hash: input.reasonHash,
    })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (error) throw new Error(`attachErc8183PreparedComplete failed: ${error.message}`);
}

// ─── Off-chain provider metadata ─────────────────────────────────────────────

/**
 * claimErc8183Job — off-chain provider metadata claim.
 *
 * Allowed only when erc8183_status = 'Funded' and status = 'created'.
 * Sets status='claimed', worker_id, provider_agent_id, claimed_at, claim_expires_at.
 * This is off-chain metadata only — the on-chain escrow is already funded.
 */
export async function claimErc8183Job(input: {
  localJobId: string;
  workerId: string;
  providerAgentId: string;
  claimTtlSeconds?: number;
}): Promise<void> {
  const db = ensureDb();
  const now = new Date().toISOString();
  const claimExpiresAt = new Date(
    Date.now() + (input.claimTtlSeconds ?? 300) * 1000,
  ).toISOString();

  const { error } = await db
    .from('agent_jobs')
    .update({
      status: 'claimed',
      worker_id: input.workerId,
      provider_agent_id: input.providerAgentId,
      claimed_at: now,
      claim_expires_at: claimExpiresAt,
    })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .eq('erc8183_status', 'Funded')
    .eq('status', 'created');

  if (error) {
    throw new Error(`claimErc8183Job failed: ${error.message}`);
  }

  // Check if the update actually matched a row (atomic guard)
  const { data: check } = await db
    .from('agent_jobs')
    .select('status, worker_id')
    .eq('job_id', input.localJobId)
    .single();

  if (!check || check.status !== 'claimed' || check.worker_id !== input.workerId) {
    throw new Error(
      'erc8183_job_not_claimable — job must be in Funded/created state',
    );
  }
}

/**
 * markErc8183JobRunning — off-chain provider metadata transition.
 *
 * Allowed only when status = 'claimed' and worker_id (provider) matches the caller.
 * Sets status = 'running', started_at.
 * This is off-chain metadata only.
 */
export async function markErc8183JobRunning(input: {
  localJobId: string;
  workerId: string;
}): Promise<void> {
  const db = ensureDb();
  const now = new Date().toISOString();

  const { error } = await db
    .from('agent_jobs')
    .update({
      status: 'running',
      started_at: now,
    })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .eq('status', 'claimed')
    .eq('worker_id', input.workerId);

  if (error) {
    throw new Error(`markErc8183JobRunning failed: ${error.message}`);
  }

  // Verify the update took effect
  const { data: check } = await db
    .from('agent_jobs')
    .select('status')
    .eq('job_id', input.localJobId)
    .single();

  if (!check || check.status !== 'running') {
    throw new Error(
      'erc8183_job_not_running — job must be claimed by the same worker',
    );
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function updateErc8183Status(input: {
  localJobId: string;
  erc8183Status: Erc8183Status;
  status?: string;
}): Promise<void> {
  const db = ensureDb();
  const update: Record<string, unknown> = {
    erc8183_status: input.erc8183Status,
  };
  if (input.status) update.status = input.status;

  const { error } = await db
    .from('agent_jobs')
    .update(update)
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (error) throw new Error(`updateErc8183Status failed: ${error.message}`);
}

/**
 * attachErc8183RejectTx — persist reject tx hash, reason, and status.
 *
 * Allowed only when erc8183_status is Open, Funded, or Submitted.
 * Sets reject_tx_hash, rejected_at, reject_reason_text, reject_reason_hash,
 * erc8183_status='Rejected', status='rejected'.
 */
export async function attachErc8183RejectTx(input: {
  localJobId: string;
  rejectTxHash: string;
  rejectReasonText: string;
  rejectReasonHash: string;
}): Promise<void> {
  const db = ensureDb();
  const field = 'reject_tx_hash';

  const existing = await readTxColumn(db, input.localJobId, field);

  try {
    assertImmutableTxHash({
      existingTxHash: existing,
      nextTxHash: input.rejectTxHash,
      fieldName: field,
    });
  } catch (err) {
    if (err instanceof Erc8183TxHashIdempotentError) return;
    throw err;
  }

  const { data: updated, error } = await db
    .from('agent_jobs')
    .update({
      reject_tx_hash: input.rejectTxHash,
      rejected_at: new Date().toISOString(),
      reject_reason_text: input.rejectReasonText,
      reject_reason_hash: input.rejectReasonHash,
      erc8183_status: 'Rejected',
      status: 'rejected',
    })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .in('erc8183_status', ['Open', 'Funded', 'Submitted'])
    .is('reject_tx_hash', null)
    .select('job_id');

  if (error) throw new Error(`attachErc8183RejectTx failed: ${error.message}`);

  if (!updated || updated.length === 0) {
    const actual = await readTxColumn(db, input.localJobId, field);
    if (actual && normalizeTxHash(actual) === normalizeTxHash(input.rejectTxHash)) return;
    throw new Erc8183TxHashConflictError(field, actual ?? 'unknown', input.rejectTxHash);
  }
}

/**
 * claimErc8183Reject — atomic local claim before sending reject tx.
 *
 * Sets status='rejecting' only if the job is still in Submitted status
 * and has no reject_tx_hash yet. Returns true if the claim succeeded,
 * false if already claimed/finalized.
 *
 * This prevents the race where two evaluator requests both pass the
 * Submitted check and both broadcast reject txs.
 */
export async function claimErc8183Reject(input: {
  localJobId: string;
}): Promise<boolean> {
  const db = ensureDb();

  const { data, error } = await db
    .from('agent_jobs')
    .update({ status: 'rejecting' })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .eq('erc8183_status', 'Submitted')
    .eq('status', 'submitted')
    .is('reject_tx_hash', null)
    .select('job_id');

  if (error) throw new Error(`claimErc8183Reject failed: ${error.message}`);

  return !!data && data.length > 0;
}

/**
 * markErc8183RejectFailed — rollback status from 'rejecting' to 'submitted'.
 *
 * Called when the reject tx fails (writeContract error, revert, receipt timeout).
 * Restores the job to a rejectable state so the evaluator can retry.
 */
export async function markErc8183RejectFailed(input: {
  localJobId: string;
}): Promise<void> {
  const db = ensureDb();

  const { error } = await db
    .from('agent_jobs')
    .update({ status: 'submitted' })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .eq('status', 'rejecting')
    .eq('erc8183_status', 'Submitted');

  if (error) throw new Error(`markErc8183RejectFailed failed: ${error.message}`);
}
