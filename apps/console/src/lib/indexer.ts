import {
  AGENT_REGISTRY_ABI,
  CONTRACTS,
  JOB_ESCROW_ABI,
  REPUTATION_ORACLE_ABI,
  WORK_PROOF_ABI,
  publicClient,
} from '@arclayer/sdk';

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

/**
 * Source tag for fallback-aware components. 'indexer' = served from cached
 * indexer service; 'rpc' = fetched directly from chain when indexer is down
 * or returned an error.
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

// ─────────────────────────────────────────────────────────────────────────────
// RPC Fallback
//
// When the indexer is degraded (502 from the proxy, network timeout, or the
// service returns 5xx), the detail pages should still render. These helpers
// read the same data straight from contracts via the SDK's public client.
//
// Trade-offs vs indexer:
//  • Slower: 1–6 RPC calls per page load (multicall amortizes most of it).
//  • Lossy: only on-chain state, no off-chain enrichment (e.g. metadata URI
//    resolution, autonomous-feed cross-references).
//  • No event history: just current state.
//
// The wrapper functions try the indexer first, then fall back. The caller
// gets a `source` tag so the UI can show a "degraded" banner.
// ─────────────────────────────────────────────────────────────────────────────

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

type AgentTuple = {
  agentId: bigint;
  skillHash: `0x${string}`;
  metadataURI: string;
  controller: `0x${string}`;
  registeredAt: bigint;
  reputationScore: bigint;
  exists: boolean;
};

type JobTuple = readonly [
  bigint,        // id
  bigint,        // agentId
  `0x${string}`, // client
  `0x${string}`, // worker
  `0x${string}`, // evaluator
  bigint,        // budget
  bigint,        // fundedAmount
  bigint,        // createdAt
  `0x${string}`, // jobSpecHash
  string,        // deliverableURI
  string,        // proofMetadataURI
  boolean,       // approved
  number,        // status
];

type ProofTuple = {
  jobId: bigint;
  agentId: bigint;
  payer: `0x${string}`;
  amountPaid: bigint;
  mintedAt: bigint;
  metadataURI: string;
};

function normalizeJob(t: JobTuple): IndexedJob {
  return {
    id: t[0].toString(),
    agentId: t[1].toString(),
    client: t[2],
    worker: t[3],
    evaluator: t[4],
    budget: t[5].toString(),
    fundedAmount: t[6].toString(),
    createdAt: t[7].toString(),
    jobSpecHash: t[8],
    deliverableURI: t[9],
    proofMetadataURI: t[10],
    approved: t[11],
    status: t[12],
  };
}

function normalizeProof(tokenId: bigint, p: ProofTuple): IndexedProof {
  return {
    tokenId: tokenId.toString(),
    jobId: p.jobId.toString(),
    agentId: p.agentId.toString(),
    payer: p.payer,
    amountPaid: p.amountPaid.toString(),
    mintedAt: p.mintedAt.toString(),
    metadataURI: p.metadataURI,
  };
}

async function fetchAgentDetailRpc(agentId: string): Promise<AgentDetail> {
  const idBig = BigInt(agentId);

  // 1) Agent profile + job IDs + proof token IDs + reputation score.
  const [agent, jobIds, proofTokenIds, score] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.AGENT_REGISTRY,
      abi: AGENT_REGISTRY_ABI,
      functionName: 'getAgent',
      args: [idBig],
    }) as Promise<AgentTuple>,
    publicClient.readContract({
      address: CONTRACTS.JOB_ESCROW,
      abi: JOB_ESCROW_ABI,
      functionName: 'getJobsByAgentId',
      args: [idBig],
    }) as Promise<readonly bigint[]>,
    publicClient.readContract({
      address: CONTRACTS.WORK_PROOF,
      abi: WORK_PROOF_ABI,
      functionName: 'getProofsByAgent',
      args: [idBig],
    }) as Promise<readonly bigint[]>,
    publicClient
      .readContract({
        address: CONTRACTS.REPUTATION_ORACLE,
        abi: REPUTATION_ORACLE_ABI,
        functionName: 'getScore',
        args: [idBig],
      })
      .catch(() => BigInt(0)) as Promise<bigint>,
  ]);

  if (!agent.exists) {
    throw new Error('Agent not found.');
  }

  // 2) Hydrate jobs and proofs in parallel. Each is a single eth_call;
  // viem will batch them automatically when the RPC supports multicall.
  const [jobs, proofs] = await Promise.all([
    Promise.all(
      jobIds.map((jid) =>
        publicClient
          .readContract({
            address: CONTRACTS.JOB_ESCROW,
            abi: JOB_ESCROW_ABI,
            functionName: 'jobs',
            args: [jid],
          })
          .then((tuple) => normalizeJob(tuple as JobTuple)),
      ),
    ),
    Promise.all(
      proofTokenIds.map((tid) =>
        publicClient
          .readContract({
            address: CONTRACTS.WORK_PROOF,
            abi: WORK_PROOF_ABI,
            functionName: 'getProof',
            args: [tid],
          })
          .then((p) => normalizeProof(tid, p as ProofTuple)),
      ),
    ),
  ]);

  const indexedAgent: IndexedAgent = {
    agentId: agent.agentId.toString(),
    controller: agent.controller,
    skillHash: agent.skillHash,
    metadataURI: agent.metadataURI,
    registeredAt: agent.registeredAt.toString(),
    reputationScore: agent.reputationScore.toString(),
    score: score.toString(),
    jobs: jobIds.map((j) => j.toString()),
    proofTokenIds: proofTokenIds.map((p) => p.toString()),
  };

  return { agent: indexedAgent, jobs, proofs };
}

async function fetchJobDetailRpc(jobId: string): Promise<JobDetail> {
  const idBig = BigInt(jobId);

  const [jobTuple, proofTokenId] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.JOB_ESCROW,
      abi: JOB_ESCROW_ABI,
      functionName: 'jobs',
      args: [idBig],
    }) as Promise<JobTuple>,
    publicClient.readContract({
      address: CONTRACTS.WORK_PROOF,
      abi: WORK_PROOF_ABI,
      functionName: 'proofTokenByJobId',
      args: [idBig],
    }) as Promise<bigint>,
  ]);

  // jobs(id) on a non-existent ID returns the zero tuple; the .id field is 0.
  if (jobTuple[0] === BigInt(0) && jobTuple[2] === '0x0000000000000000000000000000000000000000') {
    throw new Error('Job not found.');
  }

  const job = normalizeJob(jobTuple);

  let proof: IndexedProof | null = null;
  if (proofTokenId !== BigInt(0)) {
    const p = (await publicClient.readContract({
      address: CONTRACTS.WORK_PROOF,
      abi: WORK_PROOF_ABI,
      functionName: 'getProof',
      args: [proofTokenId],
    })) as ProofTuple;
    proof = normalizeProof(proofTokenId, p);
  }

  return { job, proof };
}

/**
 * Try the indexer first. Fall back to direct RPC reads on failure. Returns the
 * payload alongside a `source` tag so the caller can flag degraded data in UI.
 *
 * Distinguishes "not found" (404 from indexer or zero tuple from chain) from
 * "indexer down" (502 / network error) — only the latter triggers fallback.
 * 404 is rethrown so the page can render its empty state.
 */
export async function loadAgentDetail(agentId: string): Promise<Sourced<AgentDetail>> {
  try {
    const data = await fetchIndexerJson<AgentDetail>(`/agents/${agentId}`);
    return { data, source: 'indexer' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('not found')) throw err;
    // Indexer is degraded — fall back to chain.
    const data = await fetchAgentDetailRpc(agentId);
    return { data, source: 'rpc' };
  }
}

export async function loadJobDetail(jobId: string): Promise<Sourced<JobDetail>> {
  try {
    const data = await fetchIndexerJson<JobDetail>(`/jobs/${jobId}`);
    return { data, source: 'indexer' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('not found')) throw err;
    const data = await fetchJobDetailRpc(jobId);
    return { data, source: 'rpc' };
  }
}
