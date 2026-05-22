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

export const INDEXER_BASE_URL = process.env.NEXT_PUBLIC_INDEXER_URL || 'https://indexer.arclayers.xyz';

export function indexerUrl(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${INDEXER_BASE_URL}${normalized}`;
}

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
  statusLabel: 'Open' | 'Funded' | 'Submitted' | 'Completed' | 'Rejected' | 'Expired';
  /** Transitional compatibility for components still rendering legacy field names. */
  worker: string;
  agentId?: string;
  jobSpecHash: string;
  deliverableURI: string;
  proofMetadataURI: string;
  approved: boolean;
  createdAt: string;
};

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
  tokenId?: string;
  source?: 'imported_arclayer_registry' | 'erc8004_identity_registry' | string;
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
    budgetedUsdc?: string;
    fundedUsdc?: string;
    totalBudgetAtomic?: string;
    totalFundedAtomic?: string;
    totalBudget: string;
    totalFunded: string;
    settledJobs: number;
    fundedJobs: number;
    meta?: {
      importedAgentCount?: number;
      erc8004AgentCount?: number;
    };
    agentBreakdown?: Record<string, number>;
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
  const response = await fetch(indexerUrl(path));
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
    const res = await fetch(indexerUrl(INDEXER_HEALTH_PATH), {
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
