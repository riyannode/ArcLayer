export const INDEXER_BASE_URL = process.env.NEXT_PUBLIC_INDEXER_URL || '/api/indexer';

export type IndexedJob = {
  id: string;
  agentId: string;
  client: string;
  worker: string;
  evaluator: string;
  budget: string;
  fundedAmount: string;
  createdAt: string;
  jobSpecHash: string;
  deliverableURI: string;
  proofMetadataURI: string;
  approved: boolean;
  status: number;
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
