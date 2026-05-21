import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { dispatchWebhookEvent } from '@/lib/a2a/webhooks';

export type A2AJobStatus = 'open' | 'claimed' | 'submitted';

export type A2AJob = {
  id: string;
  title: string;
  description: string;
  category?: string;
  roleId?: string;
  budget?: string;
  requester: string;
  agentId?: string;
  claimedBy?: string;
  status: A2AJobStatus;
  input?: unknown;
  output?: unknown;
  proof?: unknown;
  createdAt: string;
  claimedAt?: string;
  submittedAt?: string;
  is_onchain?: boolean | null;
  onchain_job_id?: string | null;
  provider?: string | null;
  evaluator?: string | null;
  budget_atomic?: string | null;
  fund_tx?: string | null;
  submit_tx?: string | null;
  complete_tx?: string | null;
  settlement_status?: string | number | null;
  deliverable_uri?: string | null;
  deliverable_hash?: string | null;
  proof_uri?: string | null;
};

type CreateJobInput = {
  title: string;
  description: string;
  category?: string;
  roleId?: string;
  budget?: string;
  requester?: string;
  agentId?: string;
  input?: unknown;
};

type SubmitJobInput = {
  agentId: string;
  output?: unknown;
  proof?: unknown;
  summary?: string;
};

const TABLE = 'a2a_jobs';

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

let jobSeq = 0;

function nextJobId(input: CreateJobInput) {
  jobSeq += 1;
  return `job_${stableHash({ input, seq: jobSeq, ts: Date.now() })}`;
}

/** Map DB row (snake_case) → A2AJob (camelCase) */
function rowToJob(row: Record<string, unknown>): A2AJob {
  return {
    id: row.id as string,
    title: row.title as string,
    description: row.description as string,
    category: (row.category as string) || undefined,
    roleId: (row.role_id as string) || undefined,
    budget: (row.budget as string) || undefined,
    requester: row.requester as string,
    agentId: (row.agent_id as string) || undefined,
    claimedBy: (row.claimed_by as string) || undefined,
    status: row.status as A2AJobStatus,
    input: row.input ?? undefined,
    output: row.output ?? undefined,
    proof: row.proof ?? undefined,
    createdAt: row.created_at as string,
    claimedAt: (row.claimed_at as string) || undefined,
    submittedAt: (row.submitted_at as string) || undefined,
    is_onchain: (row.is_onchain as boolean | null) ?? null,
    onchain_job_id: row.onchain_job_id == null ? null : String(row.onchain_job_id),
    provider: (row.provider as string | null) ?? null,
    evaluator: (row.evaluator as string | null) ?? null,
    budget_atomic: row.budget_atomic == null ? null : String(row.budget_atomic),
    fund_tx: (row.fund_tx as string | null) ?? null,
    submit_tx: (row.submit_tx as string | null) ?? null,
    complete_tx: (row.complete_tx as string | null) ?? null,
    settlement_status: (row.settlement_status as string | number | null) ?? null,
    deliverable_uri: (row.deliverable_uri as string | null) ?? null,
    deliverable_hash: (row.deliverable_hash as string | null) ?? null,
    proof_uri: (row.proof_uri as string | null) ?? null,
  };
}

export async function listA2AJobs(
  filters: { status?: string | null; agentId?: string | null; roleId?: string | null; category?: string | null; evaluator?: string | null; provider?: string | null; limit?: number; offset?: number } = {}
): Promise<A2AJob[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase.from(TABLE).select('*').order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.agentId) query = query.or(`agent_id.eq.${filters.agentId},claimed_by.eq.${filters.agentId}`);
  if (filters.roleId) query = query.eq('role_id', filters.roleId);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.evaluator) query = query.ilike('evaluator', filters.evaluator);
  if (filters.provider) query = query.ilike('provider', filters.provider);

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) {
    console.error('[a2a.jobs] list error', error.message);
    return [];
  }
  return (data ?? []).map(rowToJob);
}

export async function getA2AJob(id: string): Promise<A2AJob | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) {
    console.error('[a2a.jobs] get error', error.message);
    return null;
  }
  return data ? rowToJob(data) : null;
}

export async function createA2AJob(input: CreateJobInput): Promise<A2AJob> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const id = nextJobId(input);

  const row = {
    id,
    title: input.title.trim(),
    description: input.description.trim(),
    category: input.category?.trim() || null,
    role_id: input.roleId?.trim() || null,
    budget: input.budget?.trim() || '0.00',
    requester: input.requester?.trim() || 'anonymous',
    agent_id: input.agentId?.trim() || null,
    claimed_by: null,
    status: 'open' as const,
    input: input.input ?? null,
    output: null,
    proof: null,
    created_at: now,
    claimed_at: null,
    submitted_at: null,
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select().single();
  if (error) {
    console.error('[a2a.jobs] create error', error.message);
    // Fallback: return constructed job even if DB write failed
    return rowToJob(row);
  }
  const job = rowToJob(data);
  dispatchWebhookEvent('job.created', { job }).catch(() => {});
  return job;
}

export async function claimA2AJob(id: string, agentId: string): Promise<{ ok: true; job: A2AJob } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin();

  // Fetch current state
  const { data: current, error: fetchErr } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (fetchErr || !current) return { ok: false, error: 'job_not_found' };
  if (current.status !== 'open' && current.claimed_by !== agentId) return { ok: false, error: 'job_already_claimed' };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: 'claimed',
      agent_id: agentId,
      claimed_by: agentId,
      claimed_at: current.claimed_at ?? now,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[a2a.jobs] claim error', error.message);
    return { ok: false, error: 'db_error' };
  }
  const job = rowToJob(data);
  dispatchWebhookEvent('job.claimed', { job, claimedBy: agentId }).catch(() => {});
  return { ok: true, job };
}

export async function submitA2AJob(id: string, input: SubmitJobInput): Promise<{ ok: true; job: A2AJob; receipt: { id: string; jobId: string; agentId: string; status: string; submittedAt: string } } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin();

  const { data: current, error: fetchErr } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (fetchErr || !current) return { ok: false, error: 'job_not_found' };
  if (current.claimed_by && current.claimed_by !== input.agentId) return { ok: false, error: 'agent_did_not_claim_job' };

  const now = new Date().toISOString();
  const receiptId = `receipt_${stableHash({ id, agentId: input.agentId, output: input.output, proof: input.proof })}`;

  const updatePayload: Record<string, unknown> = {
    status: 'submitted',
    output: input.output ?? input.summary ?? null,
    proof: input.proof ?? null,
    submitted_at: now,
  };

  // If not yet claimed, claim it now
  if (!current.claimed_by) {
    updatePayload.agent_id = input.agentId;
    updatePayload.claimed_by = input.agentId;
    updatePayload.claimed_at = now;
  }

  const { data, error } = await supabase.from(TABLE).update(updatePayload).eq('id', id).select().single();
  if (error) {
    console.error('[a2a.jobs] submit error', error.message);
    return { ok: false, error: 'db_error' };
  }

  const job = rowToJob(data);
  dispatchWebhookEvent('job.submitted', { job, agentId: input.agentId, receiptId }).catch(() => {});
  return {
    ok: true,
    job,
    receipt: { id: receiptId, jobId: id, agentId: input.agentId, status: 'pending_verification', submittedAt: job.submittedAt! },
  };
}
