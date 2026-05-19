import { createHash } from 'crypto';

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

const globalForJobs = globalThis as unknown as { __arclayerA2AJobs?: Map<string, A2AJob>; __arclayerA2AJobSeq?: number };
const store = globalForJobs.__arclayerA2AJobs ?? new Map<string, A2AJob>();
globalForJobs.__arclayerA2AJobs = store;
globalForJobs.__arclayerA2AJobSeq = globalForJobs.__arclayerA2AJobSeq ?? 0;

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function nextJobId(input: CreateJobInput) {
  globalForJobs.__arclayerA2AJobSeq = (globalForJobs.__arclayerA2AJobSeq ?? 0) + 1;
  return `job_${stableHash({ input, seq: globalForJobs.__arclayerA2AJobSeq })}`;
}

export function listA2AJobs(filters: { status?: string | null; agentId?: string | null; roleId?: string | null; category?: string | null } = {}) {
  return Array.from(store.values())
    .filter((job) => !filters.status || job.status === filters.status)
    .filter((job) => !filters.agentId || job.agentId === filters.agentId || job.claimedBy === filters.agentId)
    .filter((job) => !filters.roleId || job.roleId === filters.roleId)
    .filter((job) => !filters.category || job.category === filters.category)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createA2AJob(input: CreateJobInput) {
  const now = new Date().toISOString();
  const job: A2AJob = {
    id: nextJobId(input),
    title: input.title.trim(),
    description: input.description.trim(),
    category: input.category?.trim() || undefined,
    roleId: input.roleId?.trim() || undefined,
    budget: input.budget?.trim() || '0.00',
    requester: input.requester?.trim() || 'anonymous',
    agentId: input.agentId?.trim() || undefined,
    input: input.input,
    status: 'open',
    createdAt: now,
  };
  store.set(job.id, job);
  return job;
}

export function getA2AJob(id: string) {
  return store.get(id) ?? null;
}

export function claimA2AJob(id: string, agentId: string) {
  const job = store.get(id);
  if (!job) return { ok: false as const, error: 'job_not_found' };
  if (job.status !== 'open' && job.claimedBy !== agentId) return { ok: false as const, error: 'job_already_claimed' };
  const updated: A2AJob = { ...job, status: 'claimed', agentId, claimedBy: agentId, claimedAt: job.claimedAt ?? new Date().toISOString() };
  store.set(id, updated);
  return { ok: true as const, job: updated };
}

export function submitA2AJob(id: string, input: SubmitJobInput) {
  const job = store.get(id);
  if (!job) return { ok: false as const, error: 'job_not_found' };
  if (job.claimedBy && job.claimedBy !== input.agentId) return { ok: false as const, error: 'agent_did_not_claim_job' };
  const claimed = job.claimedBy ? job : { ...job, status: 'claimed' as const, agentId: input.agentId, claimedBy: input.agentId, claimedAt: new Date().toISOString() };
  const receiptId = `receipt_${stableHash({ id, agentId: input.agentId, output: input.output, proof: input.proof })}`;
  const updated: A2AJob = { ...claimed, status: 'submitted', output: input.output ?? input.summary, proof: input.proof, submittedAt: new Date().toISOString() };
  store.set(id, updated);
  return { ok: true as const, job: updated, receipt: { id: receiptId, jobId: id, agentId: input.agentId, status: 'pending_verification', submittedAt: updated.submittedAt } };
}
