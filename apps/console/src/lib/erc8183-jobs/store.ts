/**
 * ERC-8183 Escrow Job Store — local mirror & worker metadata operations.
 *
 * All functions operate on the shared agent_jobs table with
 * settlement_mode = 'erc8183_escrow'. No x402 calls, no private keys.
 *
 * The on-chain AgenticCommerce contract is the source of truth for
 * escrow state. This store is a local mirror for:
 *   - worker claim/running metadata
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
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`getErc8183JobByOnchainId failed: ${error.message}`);
  }
  return mapRow(data);
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
  const { error } = await db
    .from('agent_jobs')
    .update({ set_budget_tx_hash: input.setBudgetTxHash })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (error) throw new Error(`attachErc8183SetBudgetTx failed: ${error.message}`);
}

export async function attachErc8183ApproveTx(input: {
  localJobId: string;
  approveTxHash: string;
}): Promise<void> {
  const db = ensureDb();
  const { error } = await db
    .from('agent_jobs')
    .update({ approve_tx_hash: input.approveTxHash })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (error) throw new Error(`attachErc8183ApproveTx failed: ${error.message}`);
}

export async function attachErc8183FundTx(input: {
  localJobId: string;
  fundTxHash: string;
  erc8183Status: Erc8183Status;
}): Promise<void> {
  const db = ensureDb();
  const { error } = await db
    .from('agent_jobs')
    .update({
      fund_tx_hash: input.fundTxHash,
      erc8183_status: input.erc8183Status,
    })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (error) throw new Error(`attachErc8183FundTx failed: ${error.message}`);
}

export async function attachErc8183SubmitTx(input: {
  localJobId: string;
  submitTxHash: string;
  erc8183Status: Erc8183Status;
  status?: string;
}): Promise<void> {
  const db = ensureDb();
  const update: Record<string, unknown> = {
    submit_tx_hash: input.submitTxHash,
    erc8183_status: input.erc8183Status,
  };
  if (input.status) update.status = input.status;
  if (input.status === 'submitted') update.submitted_at = new Date().toISOString();

  const { error } = await db
    .from('agent_jobs')
    .update(update)
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (error) throw new Error(`attachErc8183SubmitTx failed: ${error.message}`);
}

export async function attachErc8183CompleteTx(input: {
  localJobId: string;
  completeTxHash: string;
  erc8183Status: Erc8183Status;
}): Promise<void> {
  const db = ensureDb();
  const { error } = await db
    .from('agent_jobs')
    .update({
      complete_tx_hash: input.completeTxHash,
      erc8183_status: input.erc8183Status,
      status: 'settled',
      settled_at: new Date().toISOString(),
    })
    .eq('job_id', input.localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (error) throw new Error(`attachErc8183CompleteTx failed: ${error.message}`);
}

// ─── Off-chain worker metadata ───────────────────────────────────────────────

/**
 * claimErc8183Job — off-chain worker metadata claim.
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
 * markErc8183JobRunning — off-chain worker metadata transition.
 *
 * Allowed only when status = 'claimed' and worker_id matches the caller.
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
