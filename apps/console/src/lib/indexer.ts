/**
 * indexer.ts — ArcLayer console indexer client.
 *
 * In Pure Arc reference mode the on-chain contracts (ERC-8004 + ERC-8183) do
 * NOT expose the bespoke read functions the legacy ArcLayer custom contracts
 * provided (`getAgent`, `getJobsByAgentId`, `WORK_PROOF`, `REPUTATION_ORACLE`,
 * etc.). The indexer service is therefore the single source of truth for all
 * derived/aggregated views. There is no on-chain RPC fallback — if the
 * indexer is down, components must show a degraded state instead of trying
 * to recompute aggregates client-side.
 */

export const INDEXER_BASE_URL = process.env.NEXT_PUBLIC_INDEXER_URL || '/api/indexer';

export type IndexedJob = {
  id: string;
  client: string;
  provider: string;
  evaluator: string;
  hook: string;
  expiredAt: string;
  description: string;
  budget: string;
  fundedAmount: string;
  createdAtBlock: string;
  updatedAtBlock: string;
  deliverable: string;
  completionReason: string;
  status: number;
  statusLabel: 'Created' | 'Budgeted' | 'Funded' | 'Submitted' | 'Completed';

  // ── Legacy aliases (deprecated) — kept for in-flight UI components migrating
  // to the official ERC-8183 schema. Populated by the fetch-time adapter
  // `withLegacyJobAliases()`. New code should use the official fields above.
  /** @deprecated Use `provider`. */
  worker: string;
  /** @deprecated No agent linkage in official ERC-8183 — use `provider` (agent address). */
  agentId: string;
  /** @deprecated Use `description`. */
  jobSpecHash: string;
  /** @deprecated Use `deliverable` (bytes32 hash). */
  deliverableURI: string;
  /** @deprecated No proof URI in official ERC-8183 reference flow. */
  proofMetadataURI: string;
  /** @deprecated Use `status === 4` and `completionReason`. */
  approved: boolean;
  /** @deprecated Use `createdAtBlock`. */
  createdAt: string;
};

/**
 * Fetch-time adapter — accepts a raw indexer job (official ERC-8183 fields)
 * and decorates it with deprecated legacy aliases so legacy UI components
 * compile during migration. Drop this once all consumers are migrated.
 */
export function withLegacyJobAliases(job: IndexedJob): IndexedJob {
  return {
    ...job,
    worker: job.provider,
    agentId: job.provider, // best-effort — official ERC-8183 has no agent linkage
    jobSpecHash: job.description,
    deliverableURI: job.deliverable,
    proofMetadataURI: '',
    approved: job.status === 4,
    createdAt: job.createdAtBlock,
  };
}

export type IndexedAgent = {
  agentId: string;
  controller: string;
  skillHash: string;
  metadataURI: string;
  registeredAt: string;
  reputationScore: string;
  score: string;
  jobs: string[];
  proofTokenIds: string[];
};

export type IndexedProof = {
  tokenId: string;
  jobId: string;
  agentId: string;
  payer: string;
  amountPaid: string;
  mintedAt: string;
  metadataURI: string;
};

export type DashboardOverview = {
  summary: {
    eventCount: number;
    jobs: number;
    agents: number;
    proofs: number;
    totalBudget: string;
    totalFunded: string;
    settledJobs: number;
    fundedJobs: number;
  };
  jobs: IndexedJob[];
  agents: IndexedAgent[];
  proofs: IndexedProof[];
};

export type AgentDetail = {
  agent: IndexedAgent;
  jobs: IndexedJob[];
  proofs: IndexedProof[];
};

export type JobDetail = {
  job: IndexedJob;
  proof: IndexedProof | null;
};

/**
 * Source tag retained for backwards-compat with components that branch on it.
 * In Pure Arc reference mode the value is always 'indexer' because the RPC
 * fallback path was removed (the official contracts don't expose the legacy
 * aggregated views).
 */
export type DataSource = 'indexer' | 'rpc';

export type Sourced<T> = { data: T; source: DataSource };

export async function fetchIndexerJson<T>(path: string) {
  const response = await fetch(`${INDEXER_BASE_URL}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'Resource not found.' : `Indexer returned HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}

export async function waitForIndexer<T>(
  path: string,
  predicate: (payload: T) => boolean,
  options?: { attempts?: number; delayMs?: number }
) {
  const attempts = options?.attempts ?? 12;
  const delayMs = options?.delayMs ?? 2500;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const payload = await fetchIndexerJson<T>(path);
    if (predicate(payload)) {
      return payload;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Indexer refresh timed out.');
}

const INDEXER_HEALTH_PATH = '/health';

/** Lightweight liveness check for the banner. Returns true if /health 200s. */
export async function pingIndexer(timeoutMs = 4000): Promise<boolean> {
  try {
    const res = await fetch(`${INDEXER_BASE_URL}${INDEXER_HEALTH_PATH}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export async function loadAgentDetail(agentId: string): Promise<Sourced<AgentDetail>> {
  const data = await fetchIndexerJson<AgentDetail>(`/agents/${agentId}`);
  return { data, source: 'indexer' };
}

export async function loadJobDetail(jobId: string): Promise<Sourced<JobDetail>> {
  const data = await fetchIndexerJson<JobDetail>(`/jobs/${jobId}`);
  return { data, source: 'indexer' };
}
