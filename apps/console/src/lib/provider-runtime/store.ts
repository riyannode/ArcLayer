/**
 * Provider Runtime Store — Durable runtime memory for provider PM2 bots.
 *
 * PR #461: Enables provider bots to persist state across restarts,
 * resume active jobs, discover/apply to open/global jobs, and track
 * phase transitions with append-only checkpoints.
 *
 * Ownership: Reuses resolveAgentOwnership() from api-key-tools.ts.
 * Auth: MCP session-based. API key auth is a follow-up.
 *
 * Security:
 * - validateAgentId() at every boundary
 * - No .or() interpolation with user input
 * - No private key storage
 * - Address normalization via getAddress()
 */

import { isAddress, getAddress } from 'viem';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { validateAgentId } from '@/lib/x402/agent-payer';
import { resolveAgentOwnership } from '@/lib/mcp/api-key-tools';
import type { McpSession } from '@/lib/agent-accounts/types';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProviderAuthContext {
  session: McpSession;
  agentId: string;
}

export interface RuntimeStateRow {
  id: string;
  agent_id: string;
  role: string;
  controller_address: string | null;
  status: string;
  active_job_id: string | null;
  active_run_id: string | null;
  last_checkpoint: string | null;
  last_error: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobRunRow {
  id: string;
  agent_id: string;
  role: string;
  job_id: string;
  run_status: string;
  phase: string;
  idempotency_key: string;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface CheckpointRow {
  id: string;
  run_id: string;
  agent_id: string;
  job_id: string;
  role: string;
  phase: string;
  status: string;
  tx_hash: string | null;
  deliverable_hash: string | null;
  payload_hash: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ApplicationRow {
  id: string;
  job_id: string;
  provider_agent_id: string;
  provider_address: string;
  status: string;
  quote_amount_atomic: string | null;
  quote_amount_usdc: string | null;
  message: string | null;
  capabilities: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProviderResumePlan {
  nextAction: string;
  recommendedTool: string | null;
  reason: string;
  terminal: boolean;
  onchainStatus: string | null;
  providerAssignedToThisBot: boolean;
  providerAssignedToOther: boolean;
  lastCheckpoint: CheckpointRow | null;
  safetyNotes: string[];
}

export interface OpenJobFilter {
  limit?: number;
  minBudgetUsdc?: string;
  capability?: string;
  includeExpired?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const APPLICATION_STATUSES = ['submitted', 'withdrawn', 'selected', 'rejected', 'expired'] as const;

/** Valid provider checkpoint phases. */
export const PROVIDER_PHASES = [
  'open_job_found',
  'applied_to_open_job',
  'selected_for_open_job',
  'quoted_budget',
  'budget_tx_sent',
  'budget_confirmed',
  'waiting_for_funding',
  'funded_detected',
  'deliverable_prepared',
  'runtime_started',
  'runtime_completed',
  'runtime_failed',
  'deliverable_ready',
  'submit_tx_sent',
  'submitted_confirmed',
  'submitted_detected',
  'completed_detected',
  'rejected_detected',
  'expired_detected',
  'budget_tx_failed',
  'submit_tx_failed',
  'failed',
] as const;

export type ProviderPhase = (typeof PROVIDER_PHASES)[number];

/** On-chain status labels matching AgenticCommerce enum. */
const ONCHAIN_STATUS: Record<number, string> = {
  0: 'Open',
  1: 'Funded',
  2: 'Submitted',
  3: 'Completed',
  4: 'Rejected',
  5: 'Expired',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function buildRunIdempotencyKey(agentId: string, jobId: string): string {
  return `provider:${agentId}:job:${jobId}`;
}

function buildCheckpointIdempotencyKey(agentId: string, jobId: string, phase: string): string {
  return `provider:${agentId}:job:${jobId}:checkpoint:${phase}`;
}

function isValidPhase(phase: string): phase is ProviderPhase {
  return (PROVIDER_PHASES as readonly string[]).includes(phase);
}

function validateProviderAddress(address: string): `0x${string}` {
  const trimmed = address.trim();
  if (!isAddress(trimmed)) {
    throw Object.assign(new Error('Invalid EVM address'), { code: 'invalid_address' });
  }
  const normalized = getAddress(trimmed);
  if (normalized.toLowerCase() === ZERO_ADDRESS) {
    throw Object.assign(new Error('Address must not be zero'), { code: 'invalid_address' });
  }
  return normalized;
}

// ── Ownership ──────────────────────────────────────────────────────────────

/**
 * Assert that the MCP session owner controls the given provider agent.
 * Reuses resolveAgentOwnership() from api-key-tools.ts.
 * Returns the resolved agent row.
 */
export async function assertProviderAgentOwnership(
  agentId: string,
  auth: ProviderAuthContext,
): Promise<Record<string, unknown>> {
  validateAgentId(agentId);
  return resolveAgentOwnership(auth.session, agentId);
}

// ── Runtime State ──────────────────────────────────────────────────────────

/**
 * Get or create runtime state for a provider agent.
 * Also returns active run, latest checkpoint, active applications, and resume plan.
 * If providerAddress is provided, resume plan verifies on-chain provider matches.
 */
export async function getProviderRuntimeContext(
  agentId: string,
  auth: ProviderAuthContext,
  providerAddress?: string,
): Promise<{
  runtimeState: RuntimeStateRow | null;
  activeRun: JobRunRow | null;
  latestCheckpoint: CheckpointRow | null;
  activeApplications: ApplicationRow[];
  resumePlan: ProviderResumePlan | null;
}> {
  validateAgentId(agentId);
  await assertProviderAgentOwnership(agentId, auth);

  const supabase = getSupabaseAdmin();

  // Get runtime state
  const { data: state } = await supabase
    .from('agent_runtime_state')
    .select('*')
    .eq('agent_id', agentId)
    .eq('role', 'provider')
    .limit(1)
    .maybeSingle();

  // Get active run if state has one
  let activeRun: JobRunRow | null = null;
  let latestCheckpoint: CheckpointRow | null = null;

  if (state?.active_run_id) {
    const { data: run } = await supabase
      .from('agent_job_runs')
      .select('*')
      .eq('id', state.active_run_id)
      .eq('run_status', 'active')
      .limit(1)
      .maybeSingle();
    activeRun = run as JobRunRow | null;

    if (activeRun) {
      const { data: cp } = await supabase
        .from('agent_job_checkpoints')
        .select('*')
        .eq('run_id', activeRun.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      latestCheckpoint = cp as CheckpointRow | null;
    }
  }

  // Get active applications
  const { data: apps } = await supabase
    .from('provider_open_job_applications')
    .select('*')
    .eq('provider_agent_id', agentId)
    .eq('status', 'submitted')
    .order('created_at', { ascending: false });

  // Build resume plan if there's an active run
  let resumePlan: ProviderResumePlan | null = null;
  if (activeRun) {
    resumePlan = await buildResumePlan(agentId, activeRun, latestCheckpoint, providerAddress);
  }

  return {
    runtimeState: state as RuntimeStateRow | null,
    activeRun,
    latestCheckpoint,
    activeApplications: (apps ?? []) as ApplicationRow[],
    resumePlan,
  };
}

// ── Heartbeat ──────────────────────────────────────────────────────────────

/**
 * Update last_seen_at for a provider agent. Creates runtime state row if missing.
 */
export async function heartbeatProvider(
  agentId: string,
  auth: ProviderAuthContext,
): Promise<void> {
  validateAgentId(agentId);
  await assertProviderAgentOwnership(agentId, auth);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('agent_runtime_state')
    .upsert(
      {
        agent_id: agentId,
        role: 'provider',
        status: 'active',
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: 'agent_id,role' },
    );

  if (error) {
    throw Object.assign(new Error(`heartbeat failed: ${error.message}`), { code: 'heartbeat_failed' });
  }
}

// ── Job Runs ───────────────────────────────────────────────────────────────

/**
 * Start a new job run or return existing active run for the same agent+job.
 * Idempotent on provider:<agentId>:job:<jobId>.
 */
export async function startProviderJobRun(
  agentId: string,
  jobId: string,
  phase: ProviderPhase,
  auth: ProviderAuthContext,
): Promise<JobRunRow> {
  validateAgentId(agentId);
  if (!jobId?.trim()) {
    throw Object.assign(new Error('jobId required'), { code: 'validation_error' });
  }
  if (!isValidPhase(phase)) {
    throw Object.assign(new Error(`Invalid phase: ${phase}`), { code: 'validation_error' });
  }
  await assertProviderAgentOwnership(agentId, auth);

  const supabase = getSupabaseAdmin();
  const idempotencyKey = buildRunIdempotencyKey(agentId, jobId);
  const now = new Date().toISOString();

  // Check for existing active run
  const { data: existing } = await supabase
    .from('agent_job_runs')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .eq('run_status', 'active')
    .limit(1)
    .maybeSingle();

  if (existing) {
    return existing as JobRunRow;
  }

  // Create new run
  const { data: run, error } = await supabase
    .from('agent_job_runs')
    .insert({
      agent_id: agentId,
      role: 'provider',
      job_id: jobId,
      run_status: 'active',
      phase,
      idempotency_key: idempotencyKey,
      started_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) {
    // Handle unique constraint violation (race condition)
    if (error.code === '23505') {
      const { data: raced } = await supabase
        .from('agent_job_runs')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .limit(1)
        .maybeSingle();
      if (raced) return raced as JobRunRow;
    }
    throw Object.assign(new Error(`startJobRun failed: ${error.message}`), { code: 'start_run_failed' });
  }

  // Update runtime state with active job/run
  await supabase
    .from('agent_runtime_state')
    .upsert(
      {
        agent_id: agentId,
        role: 'provider',
        active_job_id: jobId,
        active_run_id: run.id,
        status: 'active',
        updated_at: now,
      },
      { onConflict: 'agent_id,role' },
    );

  return run as JobRunRow;
}

/**
 * Write an append-only checkpoint for a job run.
 * Each call creates a new checkpoint row — checkpoints are NOT idempotent.
 * Multiple checkpoints for the same phase are allowed (e.g. retry after failure).
 */
export async function writeProviderCheckpoint(
  input: {
    agentId: string;
    jobId: string;
    runId?: string;
    phase: ProviderPhase;
    status: string;
    txHash?: string;
    deliverableHash?: string;
    payloadHash?: string;
    note?: string;
    metadata?: Record<string, unknown>;
  },
  auth: ProviderAuthContext,
): Promise<CheckpointRow> {
  validateAgentId(input.agentId);
  if (!input.jobId?.trim()) {
    throw Object.assign(new Error('jobId required'), { code: 'validation_error' });
  }
  if (!isValidPhase(input.phase)) {
    throw Object.assign(new Error(`Invalid phase: ${input.phase}`), { code: 'validation_error' });
  }
  await assertProviderAgentOwnership(input.agentId, auth);

  const supabase = getSupabaseAdmin();

  // Resolve run ID
  let runId = input.runId;
  if (!runId) {
    const idempotencyKey = buildRunIdempotencyKey(input.agentId, input.jobId);
    const { data: run } = await supabase
      .from('agent_job_runs')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .eq('run_status', 'active')
      .limit(1)
      .maybeSingle();
    if (!run) {
      throw Object.assign(new Error('No active run found. Call startProviderJobRun first.'), {
        code: 'no_active_run',
      });
    }
    runId = run.id;
  }

  const now = new Date().toISOString();

  const { data: checkpoint, error } = await supabase
    .from('agent_job_checkpoints')
    .insert({
      run_id: runId,
      agent_id: input.agentId,
      job_id: input.jobId,
      role: 'provider',
      phase: input.phase,
      status: input.status,
      tx_hash: input.txHash ?? null,
      deliverable_hash: input.deliverableHash ?? null,
      payload_hash: input.payloadHash ?? null,
      note: input.note ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    throw Object.assign(new Error(`writeCheckpoint failed: ${error.message}`), {
      code: 'checkpoint_failed',
    });
  }

  // Update runtime state with latest checkpoint info
  await supabase
    .from('agent_runtime_state')
    .update({
      last_checkpoint: input.phase,
      updated_at: now,
    })
    .eq('agent_id', input.agentId)
    .eq('role', 'provider');

  // Update the run's current phase
  await supabase
    .from('agent_job_runs')
    .update({ phase: input.phase, updated_at: now })
    .eq('id', runId);

  return checkpoint as CheckpointRow;
}

/**
 * Mark a job run as completed.
 */
export async function completeProviderJobRun(
  agentId: string,
  jobId: string,
  runId: string,
  auth: ProviderAuthContext,
): Promise<void> {
  validateAgentId(agentId);
  await assertProviderAgentOwnership(agentId, auth);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  await supabase
    .from('agent_job_runs')
    .update({ run_status: 'completed', completed_at: now, updated_at: now })
    .eq('id', runId)
    .eq('agent_id', agentId);

  // Clear active job/run from runtime state
  await supabase
    .from('agent_runtime_state')
    .update({
      active_job_id: null,
      active_run_id: null,
      updated_at: now,
    })
    .eq('agent_id', agentId)
    .eq('role', 'provider')
    .eq('active_run_id', runId);
}

/**
 * Mark a job run as failed with error info.
 */
export async function failProviderJobRun(
  agentId: string,
  jobId: string,
  runId: string,
  error: string,
  auth: ProviderAuthContext,
): Promise<void> {
  validateAgentId(agentId);
  await assertProviderAgentOwnership(agentId, auth);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  await supabase
    .from('agent_job_runs')
    .update({ run_status: 'failed', completed_at: now, updated_at: now })
    .eq('id', runId)
    .eq('agent_id', agentId);

  await supabase
    .from('agent_runtime_state')
    .update({
      active_job_id: null,
      active_run_id: null,
      last_error: error,
      updated_at: now,
    })
    .eq('agent_id', agentId)
    .eq('role', 'provider')
    .eq('active_run_id', runId);
}

// ── Resume Plan ────────────────────────────────────────────────────────────

/**
 * Build a resume plan by combining checkpoint state with on-chain job status.
 * If providerAddress is provided, verifies on-chain provider matches this bot.
 */
async function buildResumePlan(
  agentId: string,
  run: JobRunRow,
  lastCheckpoint: CheckpointRow | null,
  providerAddress?: string,
): Promise<ProviderResumePlan> {
  const safetyNotes: string[] = [];
  let onchainStatus: string | null = null;
  let providerAssignedToThisBot = false;
  let providerAssignedToOther = false;

  // Try to read on-chain job state
  try {
    const { readOnchainJob } = await import('@/lib/erc8183-jobs/receipt');
    const job = await readOnchainJob(BigInt(run.job_id));
    if (job) {
      onchainStatus = ONCHAIN_STATUS[job.status] ?? `Unknown(${job.status})`;
      const onchainProvider = job.provider.toLowerCase();
      const isZero = onchainProvider === ZERO_ADDRESS || onchainProvider === '';

      if (!isZero && providerAddress) {
        // Verify on-chain provider matches THIS bot's address
        const myAddr = providerAddress.toLowerCase();
        providerAssignedToThisBot = onchainProvider === myAddr;
        providerAssignedToOther = onchainProvider !== myAddr;
      } else if (!isZero) {
        // No providerAddress to compare — assume assigned (legacy behavior)
        providerAssignedToThisBot = true;
        safetyNotes.push('providerAddress not provided — cannot verify on-chain provider matches this bot.');
      }
    }
  } catch {
    safetyNotes.push('Could not read on-chain job state. RPC may be unavailable.');
  }

  const phase = lastCheckpoint?.phase ?? run.phase;
  const result: ProviderResumePlan = {
    nextAction: 'unknown',
    recommendedTool: null,
    reason: '',
    terminal: false,
    onchainStatus,
    providerAssignedToThisBot,
    providerAssignedToOther,
    lastCheckpoint,
    safetyNotes,
  };

  // Terminal states
  if (onchainStatus === 'Completed') {
    result.nextAction = 'none';
    result.recommendedTool = null;
    result.reason = 'Job completed. Provider paid.';
    result.terminal = true;
    return result;
  }
  if (onchainStatus === 'Rejected') {
    result.nextAction = 'none';
    result.recommendedTool = null;
    result.reason = 'Job rejected by evaluator or client. Provider not paid.';
    result.terminal = true;
    return result;
  }
  if (onchainStatus === 'Expired') {
    result.nextAction = 'none';
    result.recommendedTool = null;
    result.reason = 'Job expired. Client can claim refund.';
    result.terminal = true;
    return result;
  }

  // Assigned to another provider — not our job
  if (providerAssignedToOther) {
    result.nextAction = 'none';
    result.recommendedTool = null;
    result.reason = 'Job assigned to a different provider. Not our job.';
    result.terminal = true;
    safetyNotes.push('On-chain provider does not match this bot. Do NOT call setBudget.');
    return result;
  }

  // Phase-based resume mapping
  if (onchainStatus === 'Open' && !providerAssignedToThisBot) {
    if (phase === 'applied_to_open_job') {
      result.nextAction = 'wait_for_client_setProvider';
      result.reason = 'Application submitted. Waiting for client to assign provider onchain.';
      return result;
    }
    result.nextAction = 'apply_open_job';
    result.recommendedTool = 'provider.apply_open_job';
    result.reason = 'Open job with no provider. Apply or wait for direct assignment.';
    return result;
  }

  if (onchainStatus === 'Open' && providerAssignedToThisBot) {
    if (phase === 'budget_tx_sent' || phase === 'budget_tx_failed') {
      result.nextAction = 'retry_set_budget';
      result.recommendedTool = 'provider.prepare_set_budget_for_session';
      result.reason = 'Budget tx failed or pending. Retry setBudget.';
      safetyNotes.push('Check if previous tx confirmed before retrying.');
      return result;
    }
    if (phase === 'budget_confirmed' || phase === 'waiting_for_funding') {
      result.nextAction = 'wait_for_client_funding';
      result.reason = 'Budget set. Waiting for client to approve USDC and fund job.';
      return result;
    }
    result.nextAction = 'set_budget';
    result.recommendedTool = 'provider.prepare_set_budget_for_session';
    result.reason = 'Provider assigned, no budget set. Set budget to proceed.';
    return result;
  }

  if (onchainStatus === 'Funded') {
    // LLM execution in progress — let it finish
    if (phase === 'runtime_started') {
      result.nextAction = 'wait_for_llm_completion';
      result.reason = 'LLM execution in progress. Wait for completion or timeout.';
      return result;
    }
    // LLM completed but deliverable not yet ready (shouldn't happen normally)
    if (phase === 'runtime_completed') {
      result.nextAction = 'prepare_deliverable';
      result.reason = 'LLM completed. Compute deliverableHash and submit.';
      return result;
    }
    // LLM failed — manual intervention needed
    if (phase === 'runtime_failed') {
      result.nextAction = 'none';
      result.terminal = true;
      result.reason = 'LLM execution failed. Manual intervention or retry needed.';
      return result;
    }
    // Deliverable ready — submit it
    if (phase === 'deliverable_ready' || phase === 'deliverable_prepared') {
      result.nextAction = 'submit_deliverable';
      result.recommendedTool = 'provider.prepare_submit_job_for_session';
      result.reason = 'Deliverable ready. Submit to onchain.';
      return result;
    }
    // Submit tx sent — check if it landed
    if (phase === 'submit_tx_sent' || phase === 'submit_tx_failed') {
      result.nextAction = 'check_submit_status';
      result.recommendedTool = 'provider.runtime_get_context';
      result.reason = 'Submit tx sent. Check if it confirmed onchain.';
      return result;
    }
    // Default for Funded: need to run LLM
    result.nextAction = 'run_llm_and_submit';
    result.recommendedTool = 'provider.prepare_submit_job_for_session';
    result.reason = 'Job funded. Run LLM to generate deliverable, then submit.';
    return result;
  }

  if (onchainStatus === 'Submitted') {
    result.nextAction = 'wait_for_evaluator';
    result.reason = 'Deliverable submitted. Waiting for evaluator to complete or reject.';
    return result;
  }

  // Fallback
  result.nextAction = 'check_onchain_status';
  result.recommendedTool = 'provider.runtime_get_context';
  result.reason = `Unexpected state: onchain=${onchainStatus}, phase=${phase}`;
  safetyNotes.push('Unexpected state. Manual review recommended.');
  return result;
}

/**
 * Get resume plan for a provider agent (convenience wrapper).
 * If providerAddress is provided, verifies on-chain provider matches.
 */
export async function getProviderResumePlan(
  agentId: string,
  auth: ProviderAuthContext,
  jobId?: string,
  providerAddress?: string,
): Promise<ProviderResumePlan | null> {
  validateAgentId(agentId);
  await assertProviderAgentOwnership(agentId, auth);

  const supabase = getSupabaseAdmin();

  // Find active run
  let query = supabase
    .from('agent_job_runs')
    .select('*')
    .eq('agent_id', agentId)
    .eq('role', 'provider')
    .eq('run_status', 'active')
    .order('started_at', { ascending: false })
    .limit(1);

  if (jobId) {
    query = query.eq('job_id', jobId);
  }

  const { data: run } = await query.maybeSingle();
  if (!run) return null;

  // Get latest checkpoint
  const { data: cp } = await supabase
    .from('agent_job_checkpoints')
    .select('*')
    .eq('run_id', run.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return buildResumePlan(agentId, run as JobRunRow, cp as CheckpointRow | null, providerAddress);
}

// ── Open Job Listing ───────────────────────────────────────────────────────

/**
 * List open/global jobs from the indexer where provider = address(0).
 * Server-side filtering with bounded pagination.
 */
export async function listOpenGlobalJobs(
  filters: OpenJobFilter = {},
): Promise<unknown[]> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);

  // Fetch from indexer (no filter support — returns all jobs)
  const indexerUrl = process.env.INDEXER_URL || process.env.INDEXER_INTERNAL_URL || process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:3535';
  const res = await fetch(`${indexerUrl}/jobs`, { cache: 'no-store' });
  if (!res.ok) {
    throw Object.assign(new Error(`Indexer fetch failed: ${res.status}`), { code: 'indexer_error' });
  }

  const json = await res.json().catch(() => ({}));
  const allJobs: unknown[] = Array.isArray(json) ? json : json.jobs || json.data || [];

  // Server-side filter: provider = 0x0 AND status = Open
  const filtered = allJobs.filter((j) => {
    const job = j as Record<string, unknown>;
    const provider = String(job.provider || '').toLowerCase();
    const status = String(job.status || '').toLowerCase();

    // Must be open with zero provider
    if (provider !== ZERO_ADDRESS.toLowerCase() && provider !== '0x0' && provider !== '') {
      return false;
    }
    if (status !== 'open' && status !== '0') {
      return false;
    }

    // Optional: exclude expired
    if (!filters.includeExpired) {
      const expiredAt = job.expiredAt ?? job.expired_at;
      if (expiredAt && Number(expiredAt) > 0 && Number(expiredAt) < Date.now() / 1000) {
        return false;
      }
    }

    // Optional: min budget filter
    if (filters.minBudgetUsdc) {
      const budget = job.budget ?? job.budgetAtomic ?? job.budget_atomic;
      if (budget) {
        try {
          const budgetNum = Number(budget) / 1e6; // atomic to USDC
          if (budgetNum < Number(filters.minBudgetUsdc)) return false;
        } catch {
          // Skip budget filter if parse fails
        }
      }
    }

    return true;
  });

  return filtered.slice(0, limit);
}

/**
 * List jobs assigned to a specific provider address.
 * Returns jobs where provider = providerAddress AND status in (Open, Funded, Submitted).
 * Used for direct-assigned job discovery — catches jobs at any active phase.
 */
export async function listAssignedJobs(
  providerAddress: string,
  limit = 20,
): Promise<unknown[]> {
  // Validate and normalize address (rejects zero, applies EIP-55 checksum)
  const normalizedAddr = validateProviderAddress(providerAddress).toLowerCase();
  const cappedLimit = Math.min(Math.max(limit, 1), 50);

  const indexerUrl = process.env.INDEXER_URL || process.env.INDEXER_INTERNAL_URL || process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:3535';
  const res = await fetch(`${indexerUrl}/jobs`, { cache: 'no-store' });
  if (!res.ok) {
    throw Object.assign(new Error(`Indexer fetch failed: ${res.status}`), { code: 'indexer_error' });
  }

  const json = await res.json().catch(() => ({}));
  const allJobs: unknown[] = Array.isArray(json) ? json : json.jobs || json.data || [];

  // Filter: provider matches this address AND status is active (Open/Funded/Submitted)
  const activeStatuses = new Set(['open', 'funded', 'submitted', '0', '1', '2']);
  const filtered = allJobs.filter((j) => {
    const job = j as Record<string, unknown>;
    const provider = String(job.provider || '').toLowerCase();
    const status = String(job.status || '').toLowerCase();
    return provider === normalizedAddr && activeStatuses.has(status);
  });

  return filtered.slice(0, cappedLimit);
}

// ── Open Job Applications ──────────────────────────────────────────────────

/**
 * Apply to an open/global job. Creates or updates application.
 * Idempotent on (job_id, provider_agent_id).
 *
 * Validates onchain/indexer before applying:
 * - Job must exist
 * - Job status must be Open
 * - Job provider must be zero address (global/open)
 * - Job must not be expired
 */
export async function applyToOpenJob(
  input: {
    agentId: string;
    jobId: string;
    providerAddress: string;
    quoteAmountUsdc?: string;
    quoteAmountAtomic?: string;
    message?: string;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
  },
  auth: ProviderAuthContext,
): Promise<ApplicationRow> {
  validateAgentId(input.agentId);
  if (!input.jobId?.trim()) {
    throw Object.assign(new Error('jobId required'), { code: 'validation_error' });
  }

  // Validate and normalize provider address
  const normalizedAddress = validateProviderAddress(input.providerAddress);
  await assertProviderAgentOwnership(input.agentId, auth);

  // ── Onchain/indexer validation ─────────────────────────────────────────
  // Read job from onchain to verify it's actually open/global
  try {
    const { readOnchainJob } = await import('@/lib/erc8183-jobs/receipt');
    const job = await readOnchainJob(BigInt(input.jobId));
    if (!job) {
      throw Object.assign(new Error(`Job ${input.jobId} not found onchain`), { code: 'not_found' });
    }

    // Status must be Open (0)
    if (job.status !== 0) {
      const statusName = ONCHAIN_STATUS[job.status] ?? `Unknown(${job.status})`;
      throw Object.assign(
        new Error(`Job ${input.jobId} is ${statusName}, not Open. Cannot apply.`),
        { code: 'wrong_status' },
      );
    }

    // Provider must be zero address (open/global job)
    const jobProvider = job.provider.toLowerCase();
    if (jobProvider !== ZERO_ADDRESS && jobProvider !== '') {
      throw Object.assign(
        new Error(`Job ${input.jobId} already has provider ${job.provider}. Not an open job.`),
        { code: 'already_assigned' },
      );
    }

    // Job must not be expired
    if (job.expiredAt > 0n && job.expiredAt < BigInt(Math.floor(Date.now() / 1000))) {
      throw Object.assign(
        new Error(`Job ${input.jobId} has expired. Cannot apply.`),
        { code: 'job_expired' },
      );
    }
  } catch (err: unknown) {
    // Re-throw our own errors (validation failures from onchain read)
    if (err && typeof err === 'object' && 'code' in err) throw err;

    // RPC failed — try indexer fallback to verify job is valid
    const indexerUrl = process.env.INDEXER_URL || process.env.INDEXER_INTERNAL_URL || process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:3535';
    let verified = false;
    try {
      const res = await fetch(`${indexerUrl}/jobs/${encodeURIComponent(input.jobId)}`, { cache: 'no-store' });
      if (!res.ok) {
        throw Object.assign(
          new Error(`Cannot verify job ${input.jobId}: onchain RPC failed and indexer returned ${res.status}`),
          { code: 'verification_failed' },
        );
      }
      const body = await res.json().catch(() => ({}));
      const jobData = (body.job && typeof body.job === 'object') ? body.job : body;
      const status = String(jobData.status || '').toLowerCase();
      const provider = String(jobData.provider || '').toLowerCase();

      if (status !== 'open' && status !== '0') {
        throw Object.assign(
          new Error(`Job ${input.jobId} is ${status}, not Open. Cannot apply.`),
          { code: 'wrong_status' },
        );
      }
      if (provider !== ZERO_ADDRESS.toLowerCase() && provider !== '0x0' && provider !== '') {
        throw Object.assign(
          new Error(`Job ${input.jobId} already has provider. Not an open job.`),
          { code: 'already_assigned' },
        );
      }

      // Check expiry from indexer data
      const expiredAt = jobData.expiredAt ?? jobData.expired_at;
      if (expiredAt && Number(expiredAt) > 0 && Number(expiredAt) < Date.now() / 1000) {
        throw Object.assign(
          new Error(`Job ${input.jobId} has expired. Cannot apply.`),
          { code: 'job_expired' },
        );
      }

      verified = true;
    } catch (fallbackErr: unknown) {
      // Re-throw validation errors from indexer
      if (fallbackErr && typeof fallbackErr === 'object' && 'code' in fallbackErr) throw fallbackErr;
      // Both onchain and indexer verification failed — reject application
      throw Object.assign(
        new Error(`Cannot verify job ${input.jobId}: onchain RPC and indexer both failed. Refusing to apply without verification.`),
        { code: 'verification_failed' },
      );
    }

    if (!verified) {
      throw Object.assign(
        new Error(`Cannot verify job ${input.jobId}. Refusing to apply.`),
        { code: 'verification_failed' },
      );
    }
  }

  // Parse quote amount
  let quoteAtomic = input.quoteAmountAtomic ?? null;
  let quoteUsdc = input.quoteAmountUsdc ?? null;

  if (input.quoteAmountUsdc && !quoteAtomic) {
    // Convert USDC string to atomic using exact parser
    const { parseUsdcToAtomic } = await import('@/lib/mcp/erc8183-tools');
    quoteAtomic = parseUsdcToAtomic(input.quoteAmountUsdc).toString();
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  // Upsert application (idempotent on job_id + provider_agent_id)
  const { data: app, error } = await supabase
    .from('provider_open_job_applications')
    .upsert(
      {
        job_id: input.jobId,
        provider_agent_id: input.agentId,
        provider_address: normalizedAddress,
        status: 'submitted',
        quote_amount_atomic: quoteAtomic,
        quote_amount_usdc: quoteUsdc,
        message: input.message ?? null,
        capabilities: input.capabilities ?? [],
        metadata: input.metadata ?? {},
        updated_at: now,
      },
      { onConflict: 'job_id,provider_agent_id' },
    )
    .select()
    .single();

  if (error) {
    throw Object.assign(new Error(`applyToOpenJob failed: ${error.message}`), {
      code: 'apply_failed',
    });
  }

  return app as ApplicationRow;
}

/**
 * Withdraw an open job application.
 */
export async function withdrawOpenJobApplication(
  input: { agentId: string; jobId: string },
  auth: ProviderAuthContext,
): Promise<void> {
  validateAgentId(input.agentId);
  if (!input.jobId?.trim()) {
    throw Object.assign(new Error('jobId required'), { code: 'validation_error' });
  }
  await assertProviderAgentOwnership(input.agentId, auth);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('provider_open_job_applications')
    .update({ status: 'withdrawn', updated_at: now })
    .eq('job_id', input.jobId)
    .eq('provider_agent_id', input.agentId)
    .eq('status', 'submitted');

  if (error) {
    throw Object.assign(new Error(`withdraw failed: ${error.message}`), { code: 'withdraw_failed' });
  }
}

/**
 * List provider's open job applications.
 */
export async function listProviderApplications(
  agentId: string,
  auth: ProviderAuthContext,
  status?: string,
): Promise<ApplicationRow[]> {
  validateAgentId(agentId);
  await assertProviderAgentOwnership(agentId, auth);

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from('provider_open_job_applications')
    .select('*')
    .eq('provider_agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (status && APPLICATION_STATUSES.includes(status as (typeof APPLICATION_STATUSES)[number])) {
    query = query.eq('status', status);
  }

  const { data } = await query;
  return (data ?? []) as ApplicationRow[];
}
