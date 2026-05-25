/**
 * Agent Jobs Store — lifecycle operations for agent job fullcycle settlement.
 *
 * Status flow:
 *   created → claimed → running → submitted → verified → settlement_pending → settled
 *                                                                         ↘ failed
 *   created → cancelled / expired
 *
 * All status transitions use conditional UPDATE for race safety.
 * Settlement is idempotent via x402_resource_payments integration.
 */

import { createHash, randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

export const AGENT_JOB_STATUSES = [
  'created',
  'claimed',
  'running',
  'submitted',
  'verified',
  'settlement_pending',
  'settled',
  'failed',
  'cancelled',
  'expired',
] as const;

export type AgentJobStatus = (typeof AGENT_JOB_STATUSES)[number];

export interface AgentJob {
  id: string;
  job_id: string;
  job_type: string;
  market_id: string | null;
  buyer_agent_id: string;
  provider_agent_id: string | null;
  worker_id: string | null;
  status: AgentJobStatus;
  input_payload: Record<string, unknown>;
  input_payload_hash: string;
  result_payload: Record<string, unknown> | null;
  result_payload_hash: string | null;
  proof_payload: Record<string, unknown> | null;
  proof_payload_hash: string | null;
  price_atomic: string;
  asset: string;
  chain_id: string;
  settlement_payment_id: string | null;
  settlement_tx_hash: string | null;
  settlement_payer: string | null;
  settlement_pay_to: string | null;
  error: string | null;
  claim_expires_at: string | null;
  deadline_at: string | null;
  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  settlement_pending_at: string | null;
  settled_at: string | null;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface AgentJobEvent {
  id: string;
  job_id: string;
  event_type: string;
  actor_agent_id: string;
  status_before: string | null;
  status_after: string | null;
  payload_hash: string | null;
  payment_id: string | null;
  tx_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentJobWithEvents extends AgentJob {
  events: AgentJobEvent[];
}

export interface ListAgentJobsFilter {
  status?: AgentJobStatus;
  jobType?: string;
  marketId?: string;
  buyerAgentId?: string;
  workerId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Off-chain agent_jobs namespace metadata.
 * Added to API responses to distinguish ArcLayer off-chain agent_jobs
 * from ERC-8183 on-chain AgenticCommerce jobs.
 */
export type WithAgentJobNamespace<T> = T & {
  job_source: 'offchain_agent_jobs';
  status_namespace: 'agent_jobs';
  settlement_rail: 'x402_arc_native';
  lifecycle_label: 'ArcLayer off-chain job';
  settlement_label: 'x402 Arc-native settlement';
};

export function withAgentJobNamespace<T extends AgentJob>(job: T): WithAgentJobNamespace<T> {
  return {
    ...job,
    job_source: 'offchain_agent_jobs',
    status_namespace: 'agent_jobs',
    settlement_rail: 'x402_arc_native',
    lifecycle_label: 'ArcLayer off-chain job',
    settlement_label: 'x402 Arc-native settlement',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursive stable JSON stringify for deterministic payload hashing.
 * Canonicalizes all nesting levels so payloads with different insertion order
 * produce identical hashes.
 *
 * Example:
 *   stableStringify({a:{z:1,b:2}}) === stableStringify({a:{b:2,z:1}})
 */
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

function mapJobRow(row: Record<string, unknown>): AgentJob {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    job_type: String(row.job_type),
    market_id: row.market_id ? String(row.market_id) : null,
    buyer_agent_id: String(row.buyer_agent_id),
    provider_agent_id: row.provider_agent_id ? String(row.provider_agent_id) : null,
    worker_id: row.worker_id ? String(row.worker_id) : null,
    status: row.status as AgentJobStatus,
    input_payload: (row.input_payload as Record<string, unknown>) ?? {},
    input_payload_hash: String(row.input_payload_hash),
    result_payload: row.result_payload ? (row.result_payload as Record<string, unknown>) : null,
    result_payload_hash: row.result_payload_hash ? String(row.result_payload_hash) : null,
    proof_payload: row.proof_payload ? (row.proof_payload as Record<string, unknown>) : null,
    proof_payload_hash: row.proof_payload_hash ? String(row.proof_payload_hash) : null,
    price_atomic: String(row.price_atomic),
    asset: String(row.asset),
    chain_id: String(row.chain_id),
    settlement_payment_id: row.settlement_payment_id ? String(row.settlement_payment_id) : null,
    settlement_tx_hash: row.settlement_tx_hash ? String(row.settlement_tx_hash) : null,
    settlement_payer: row.settlement_payer ? String(row.settlement_payer) : null,
    settlement_pay_to: row.settlement_pay_to ? String(row.settlement_pay_to) : null,
    error: row.error ? String(row.error) : null,
    claim_expires_at: row.claim_expires_at ? String(row.claim_expires_at) : null,
    deadline_at: row.deadline_at ? String(row.deadline_at) : null,
    created_at: String(row.created_at),
    claimed_at: row.claimed_at ? String(row.claimed_at) : null,
    started_at: row.started_at ? String(row.started_at) : null,
    submitted_at: row.submitted_at ? String(row.submitted_at) : null,
    verified_at: row.verified_at ? String(row.verified_at) : null,
    settlement_pending_at: row.settlement_pending_at ? String(row.settlement_pending_at) : null,
    settled_at: row.settled_at ? String(row.settled_at) : null,
    updated_at: String(row.updated_at),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

function mapEventRow(row: Record<string, unknown>): AgentJobEvent {
  return {
    id: String(row.id),
    job_id: String(row.job_id),
    event_type: String(row.event_type),
    actor_agent_id: String(row.actor_agent_id),
    status_before: row.status_before ? String(row.status_before) : null,
    status_after: row.status_after ? String(row.status_after) : null,
    payload_hash: row.payload_hash ? String(row.payload_hash) : null,
    payment_id: row.payment_id ? String(row.payment_id) : null,
    tx_hash: row.tx_hash ? String(row.tx_hash) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: String(row.created_at),
  };
}

function ensureDb(): SupabaseClient {
  return getSupabaseAdmin();
}

// ─── Core operations ──────────────────────────────────────────────────────────

export async function createAgentJob(input: {
  jobId?: string;
  jobType: string;
  buyerAgentId: string;
  inputPayload: Record<string, unknown>;
  priceAtomic?: string;
  asset?: string;
  chainId?: string;
  marketId?: string;
  deadlineAt?: string;
  metadata?: Record<string, unknown>;
}): Promise<AgentJob> {
  const db = ensureDb();
  const jobId = input.jobId || `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const inputPayloadHash = sha256Hex(stableStringify(input.inputPayload));

  const { data, error } = await db
    .from('agent_jobs')
    .insert({
      job_id: jobId,
      job_type: input.jobType,
      buyer_agent_id: input.buyerAgentId,
      market_id: input.marketId ?? null,
      input_payload: input.inputPayload,
      input_payload_hash: inputPayloadHash,
      price_atomic: input.priceAtomic ?? '0',
      asset: input.asset ?? 'USDC',
      chain_id: input.chainId ?? '5042002',
      deadline_at: input.deadlineAt ?? null,
      metadata: input.metadata ?? {},
      status: 'created',
    })
    .select()
    .single();

  if (error) throw new Error(`createAgentJob failed: ${error.message}`);

  // Add created event
  await db.from('agent_job_events').insert({
    job_id: jobId,
    event_type: 'created',
    actor_agent_id: input.buyerAgentId,
    status_before: null,
    status_after: 'created',
    payload_hash: inputPayloadHash,
    metadata: { jobType: input.jobType, priceAtomic: input.priceAtomic ?? '0' },
  });

  return mapJobRow(data);
}

export async function listAgentJobs(filter: ListAgentJobsFilter = {}): Promise<AgentJob[]> {
  const db = ensureDb();
  let query = db.from('agent_jobs').select('*');

  if (filter.status) query = query.eq('status', filter.status);
  if (filter.jobType) query = query.eq('job_type', filter.jobType);
  if (filter.marketId) query = query.eq('market_id', filter.marketId);
  if (filter.buyerAgentId) query = query.eq('buyer_agent_id', filter.buyerAgentId);
  if (filter.workerId) query = query.eq('worker_id', filter.workerId);

  query = query.order('created_at', { ascending: false });

  if (filter.limit) query = query.limit(filter.limit);
  if (filter.offset) query = query.range(filter.offset, filter.offset + (filter.limit || 20) - 1);

  const { data, error } = await query;
  if (error) throw new Error(`listAgentJobs failed: ${error.message}`);
  return (data ?? []).map(mapJobRow);
}

export async function getAgentJob(jobId: string): Promise<AgentJobWithEvents | null> {
  const db = ensureDb();

  const { data: job, error: jobErr } = await db
    .from('agent_jobs')
    .select('*')
    .eq('job_id', jobId)
    .maybeSingle();

  if (jobErr) throw new Error(`getAgentJob failed: ${jobErr.message}`);
  if (!job) return null;

  const { data: events, error: evtErr } = await db
    .from('agent_job_events')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });

  if (evtErr) throw new Error(`getAgentJob events failed: ${evtErr.message}`);

  return {
    ...mapJobRow(job),
    events: (events ?? []).map(mapEventRow),
  };
}

export async function claimAgentJob(input: {
  jobType?: string;
  workerId: string;
  providerAgentId: string;
  claimTtlSeconds?: number;
}): Promise<AgentJob | null> {
  const db = ensureDb();
  const ttl = input.claimTtlSeconds ?? 300;
  const jobType = input.jobType ?? '';

  // Use the SQL function for atomic SKIP LOCKED claim
  const { data, error } = await db.rpc('claim_agent_job', {
    p_job_type: jobType,
    p_worker_id: input.workerId,
    p_provider_agent_id: input.providerAgentId,
    p_claim_ttl_seconds: ttl,
  });

  if (error) throw new Error(`claimAgentJob failed: ${error.message}`);

  if (!data || (Array.isArray(data) && data.length === 0)) {
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return mapJobRow(row);
}

/**
 * Atomic conditional update: only updates if status='claimed' AND worker_id matches.
 * Returns conflict error if no row matched the condition.
 */
export async function markJobRunning(input: {
  jobId: string;
  workerId: string;
}): Promise<AgentJob> {
  const db = ensureDb();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from('agent_jobs')
    .update({
      status: 'running',
      started_at: now,
      updated_at: now,
    })
    .eq('job_id', input.jobId)
    .eq('worker_id', input.workerId)
    .eq('status', 'claimed')
    .select()
    .maybeSingle();

  if (error) throw new Error(`markJobRunning failed: ${error.message}`);
  if (!data) {
    // Check why — worker mismatch or status mismatch
    const { data: current } = await db
      .from('agent_jobs')
      .select('status, worker_id')
      .eq('job_id', input.jobId)
      .maybeSingle();

    if (!current) throw new Error(`markJobRunning: job ${input.jobId} not found`);
    if (String(current.worker_id) !== input.workerId) {
      throw new Error(`markJobRunning: worker mismatch — job claimed by ${current.worker_id}`);
    }
    throw new Error(`markJobRunning: job ${input.jobId} is status ${current.status}, conflict`);
  }

  return mapJobRow(data);
}

/**
 * Atomic conditional update: only updates if status in ['claimed','running'] AND worker_id matches.
 */
export async function submitAgentJob(input: {
  jobId: string;
  workerId: string;
  resultPayload: Record<string, unknown>;
  proofPayload?: Record<string, unknown>;
}): Promise<AgentJob> {
  const db = ensureDb();

  const resultPayloadHash = sha256Hex(stableStringify(input.resultPayload));
  const proofPayloadHash = input.proofPayload
    ? sha256Hex(stableStringify(input.proofPayload))
    : null;

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('agent_jobs')
    .update({
      status: 'submitted',
      result_payload: input.resultPayload,
      result_payload_hash: resultPayloadHash,
      proof_payload: input.proofPayload ?? null,
      proof_payload_hash: proofPayloadHash,
      submitted_at: now,
      updated_at: now,
    })
    .eq('job_id', input.jobId)
    .eq('worker_id', input.workerId)
    .in('status', ['claimed', 'running'])
    .select()
    .maybeSingle();

  if (error) throw new Error(`submitAgentJob failed: ${error.message}`);
  if (!data) {
    const { data: current } = await db
      .from('agent_jobs')
      .select('status, worker_id')
      .eq('job_id', input.jobId)
      .maybeSingle();

    if (!current) throw new Error(`submitAgentJob: job ${input.jobId} not found`);
    if (String(current.worker_id) !== input.workerId) {
      throw new Error(`submitAgentJob: worker mismatch — job claimed by ${current.worker_id}`);
    }
    throw new Error(`submitAgentJob: job ${input.jobId} is status ${current.status}, expected claimed or running`);
  }

  return mapJobRow(data);
}

/**
 * Atomic conditional update: only updates if status='submitted'.
 */
export async function verifyAgentJob(input: {
  jobId: string;
  verifierAgentId: string;
  approved: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<AgentJob> {
  const db = ensureDb();

  const newStatus = input.approved ? 'verified' : 'failed';
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: newStatus,
    verified_at: now,
    updated_at: now,
  };
  if (input.reason) update.error = input.reason;

  const { data, error } = await db
    .from('agent_jobs')
    .update(update)
    .eq('job_id', input.jobId)
    .eq('status', 'submitted')
    .select()
    .maybeSingle();

  if (error) throw new Error(`verifyAgentJob failed: ${error.message}`);
  if (!data) {
    const { data: current } = await db
      .from('agent_jobs')
      .select('status')
      .eq('job_id', input.jobId)
      .maybeSingle();

    if (!current) throw new Error(`verifyAgentJob: job ${input.jobId} not found`);
    throw new Error(`verifyAgentJob: job ${input.jobId} is status ${current.status}, expected submitted`);
  }

  // Write verification event
  await db.from('agent_job_events').insert({
    job_id: input.jobId,
    event_type: 'verification',
    actor_agent_id: input.verifierAgentId,
    status_before: 'submitted',
    status_after: newStatus,
    metadata: input.metadata ?? {},
  });

  return mapJobRow(data);
}

/**
 * Mark job as settlement_pending.
 * - Validates buyerAgentId matches.
 * - If already settlement_pending, return existing as no-op.
 * - If verified, update atomically.
 * - Rejects all other statuses.
 */
export async function markJobSettlementPending(input: {
  jobId: string;
  buyerAgentId: string;
}): Promise<AgentJob> {
  const db = ensureDb();

  // First check current state
  const { data: current } = await db
    .from('agent_jobs')
    .select('status, buyer_agent_id')
    .eq('job_id', input.jobId)
    .maybeSingle();

  if (!current) throw new Error(`markJobSettlementPending: job ${input.jobId} not found`);

  // Validate buyer
  if (String(current.buyer_agent_id) !== input.buyerAgentId) {
    throw new Error(
      `markJobSettlementPending: buyer mismatch — job buyer is ${current.buyer_agent_id}, caller is ${input.buyerAgentId}`
    );
  }

  // If already settlement_pending, no-op
  if (current.status === 'settlement_pending') {
    const { data: existing } = await db
      .from('agent_jobs')
      .select('*')
      .eq('job_id', input.jobId)
      .single();
    return mapJobRow(existing);
  }

  // Only allow from verified
  if (current.status !== 'verified') {
    throw new Error(`markJobSettlementPending: job ${input.jobId} is status ${current.status}, expected verified`);
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('agent_jobs')
    .update({
      status: 'settlement_pending',
      settlement_pending_at: now,
      updated_at: now,
    })
    .eq('job_id', input.jobId)
    .eq('buyer_agent_id', input.buyerAgentId)
    .eq('status', 'verified')
    .select()
    .maybeSingle();

  if (error) throw new Error(`markJobSettlementPending failed: ${error.message}`);
  if (!data) {
    throw new Error(`markJobSettlementPending: job ${input.jobId} lost race, status changed from verified`);
  }

  return mapJobRow(data);
}

/**
 * Mark job as settled.
 * - Validates buyerAgentId matches.
 * - Idempotent: if already settled with same paymentId/txHash, return existing.
 * - Conflict: if settled with different paymentId/txHash.
 * - Atomic update: only where status in ['verified','settlement_pending'] AND buyer_agent_id matches.
 */
export async function markJobSettled(input: {
  jobId: string;
  buyerAgentId: string;
  paymentId: string;
  txHash: string;
  payer: string;
  payTo: string;
}): Promise<AgentJob> {
  const db = ensureDb();

  // Check current state for idempotency/conflict
  const { data: current } = await db
    .from('agent_jobs')
    .select('status, settlement_payment_id, settlement_tx_hash, buyer_agent_id')
    .eq('job_id', input.jobId)
    .maybeSingle();

  if (!current) throw new Error(`markJobSettled: job ${input.jobId} not found`);

  // Validate buyer
  if (String(current.buyer_agent_id) !== input.buyerAgentId) {
    throw new Error(
      `markJobSettled: buyer mismatch — job buyer is ${current.buyer_agent_id}, caller is ${input.buyerAgentId}`
    );
  }

  // Idempotency: already settled with same paymentId/txHash
  if (
    current.status === 'settled' &&
    String(current.settlement_payment_id) === input.paymentId &&
    String(current.settlement_tx_hash) === input.txHash
  ) {
    const { data: existing } = await db
      .from('agent_jobs')
      .select('*')
      .eq('job_id', input.jobId)
      .single();
    return mapJobRow(existing);
  }

  // Conflict: settled with different paymentId/txHash
  if (current.status === 'settled') {
    throw new Error(
      `markJobSettled conflict: job ${input.jobId} already settled with paymentId=${current.settlement_payment_id} txHash=${current.settlement_tx_hash}, cannot overwrite with paymentId=${input.paymentId} txHash=${input.txHash}`
    );
  }

  // Atomic update: only where status in ['verified','settlement_pending'] AND buyer matches
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('agent_jobs')
    .update({
      status: 'settled',
      settlement_payment_id: input.paymentId,
      settlement_tx_hash: input.txHash,
      settlement_payer: input.payer,
      settlement_pay_to: input.payTo,
      settled_at: now,
      updated_at: now,
    })
    .eq('job_id', input.jobId)
    .eq('buyer_agent_id', input.buyerAgentId)
    .in('status', ['verified', 'settlement_pending'])
    .select()
    .maybeSingle();

  if (error) throw new Error(`markJobSettled failed: ${error.message}`);
  if (!data) {
    throw new Error(`markJobSettled: job ${input.jobId} lost race, status no longer in [verified, settlement_pending]`);
  }

  // Write settlement event
  await db.from('agent_job_events').insert({
    job_id: input.jobId,
    event_type: 'settlement',
    actor_agent_id: input.buyerAgentId,
    status_before: current.status,
    status_after: 'settled',
    payment_id: input.paymentId,
    tx_hash: input.txHash,
    metadata: { payer: input.payer, payTo: input.payTo },
  });

  return mapJobRow(data);
}

export async function failAgentJob(input: {
  jobId: string;
  workerId: string;
  error: string;
}): Promise<AgentJob> {
  const db = ensureDb();

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('agent_jobs')
    .update({
      status: 'failed',
      error: input.error,
      updated_at: now,
    })
    .eq('job_id', input.jobId)
    .eq('worker_id', input.workerId)
    .filter('status', 'not.in', '("settled","verified")')
    .select()
    .maybeSingle();

  if (error) throw new Error(`failAgentJob failed: ${error.message}`);
  if (!data) {
    const { data: current } = await db
      .from('agent_jobs')
      .select('status, worker_id')
      .eq('job_id', input.jobId)
      .maybeSingle();

    if (!current) throw new Error(`failAgentJob: job ${input.jobId} not found`);
    if (String(current.worker_id) !== input.workerId) {
      throw new Error(`failAgentJob: worker mismatch — job claimed by ${current.worker_id}`);
    }
    throw new Error(`failAgentJob: cannot fail job ${input.jobId} in status ${current.status}`);
  }

  return mapJobRow(data);
}

export async function insertJobEvent(event: {
  jobId: string;
  eventType: string;
  actorAgentId: string;
  statusBefore?: string;
  statusAfter?: string;
  payloadHash?: string;
  paymentId?: string;
  txHash?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = ensureDb();
  const { error } = await db.from('agent_job_events').insert({
    job_id: event.jobId,
    event_type: event.eventType,
    actor_agent_id: event.actorAgentId,
    status_before: event.statusBefore ?? null,
    status_after: event.statusAfter ?? null,
    payload_hash: event.payloadHash ?? null,
    payment_id: event.paymentId ?? null,
    tx_hash: event.txHash ?? null,
    metadata: event.metadata ?? {},
  });
  if (error) throw new Error(`insertJobEvent failed: ${error.message}`);
}
