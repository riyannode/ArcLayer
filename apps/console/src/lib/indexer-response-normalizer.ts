/**
 * Indexer response normalizer — adapts Goldsky reader output to PM2/SQLite format.
 *
 * The PM2 indexer (indexer/src/db.ts) returns jobs/agents with legacy field names
 * (worker, jobSpecHash, deliverableURI, proofMetadataURI, approved, displayType, etc.)
 * and specific nested structures (legacyAliases on jobs, source:tokenId agentId format).
 *
 * The Goldsky Supabase reader returns SDK ProjectedJob/ProjectedAgent types which
 * have different field names and lack legacy compatibility fields.
 *
 * This normalizer ensures the /api/indexer/* route returns a consistent shape
 * regardless of which backend serves the data, so existing UI components work
 * without changes.
 *
 * @module apps/console/src/lib/indexer-response-normalizer
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** PM2-compatible job shape (what the UI expects from /api/indexer/jobs). */
export type NormalizedJob = {
  id: string;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: string;
  fundedAmount: string;
  deliverable: string;
  completionReason: string;
  status: number;
  statusLabel: string;
  createdAt: string;
  legacyAliases: {
    worker: string;
    jobSpecHash: string;
    deliverableURI: string;
    proofMetadataURI: string;
    approved: boolean;
  };
};

/** PM2-compatible agent shape (what the UI expects from /api/indexer/agents). */
export type NormalizedAgent = {
  agentId: string;
  tokenId: string;
  controller: string;
  skillHash: string;
  metadataURI: string;
  registeredAt: string;
  registeredAtBlock: string;
  reputationScore: string;
  score: string;
  jobs: string[];
  proofTokenIds: string[];
  source: string;
  chainId: string;
  registryAddress: string;
  contractAddress: string;
  transactionHash: string;
  txHash: string;
  blockNumber: string;
  importedAt: string;
  updatedAt: string;
  displayType: string;
};

/** PM2-compatible job detail shape. */
export type NormalizedJobDetail = {
  job: NormalizedJob;
  proof: {
    tokenId: string;
    jobId: string;
    agentId: string;
    payer: string;
    amountPaid: string;
    mintedAt: string;
    metadataURI: string;
  } | null;
};

/** PM2-compatible agent detail shape. */
export type NormalizedAgentDetail = {
  agent: NormalizedAgent;
  jobs: NormalizedJob[];
  proofs: unknown[];
};

/** PM2-compatible overview shape. */
export type NormalizedOverview = {
  summary: {
    eventCount: number;
    jobs: number;
    agents: number;
    meta: {
      importedAgentCount: number;
      erc8004AgentCount: number;
    };
    agentBreakdown: {
      importedAgentCount: number;
      erc8004AgentCount: number;
      totalAgentCount: number;
    };
    jobBreakdown: {
      erc8183: number;
    };
    proofs: number;
    budgetedUsdc: string;
    fundedUsdc: string;
    totalBudgetAtomic: string;
    totalFundedAtomic: string;
    totalBudget: string;
    totalFunded: string;
    settledJobs: number;
    fundedJobs: number;
  };
  jobs: NormalizedJob[];
  agents: NormalizedAgent[];
  proofs: unknown[];
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

// ── Job normalizer ─────────────────────────────────────────────────────────

/**
 * Normalize a Goldsky ProjectedJob (or any job-like object) to PM2 format.
 *
 * If the input already has `legacyAliases`, it's passed through as-is (PM2 path).
 * If not, legacy fields are synthesized from the Goldsky/SDK field names.
 */
export function normalizeJob(job: Record<string, unknown>): NormalizedJob {
  const id = String(job.id ?? "");
  const client = String(job.client ?? ZERO_ADDRESS);
  const provider = String(job.provider ?? ZERO_ADDRESS);
  const evaluator = String(job.evaluator ?? ZERO_ADDRESS);
  const description = String(job.description ?? "");
  const budget = String(job.budget ?? "0");
  const fundedAmount = String(job.fundedAmount ?? "0");
  const deliverable = String(job.deliverable ?? ZERO_BYTES32);
  const completionReason = String(job.completionReason ?? ZERO_BYTES32);
  const status = Number(job.status ?? 0);
  const statusLabel = String(job.statusLabel ?? "Open");
  const createdAt = String(job.createdAt ?? job.createdAtBlock ?? "0");

  // If PM2 format (already has legacyAliases), pass through
  if (job.legacyAliases && typeof job.legacyAliases === "object") {
    return {
      id, client, provider, evaluator, description, budget, fundedAmount,
      deliverable, completionReason, status, statusLabel, createdAt,
      legacyAliases: job.legacyAliases as NormalizedJob["legacyAliases"],
    };
  }

  // Goldsky/SDK format → synthesize legacy aliases
  return {
    id,
    client,
    provider,
    evaluator,
    description,
    budget,
    fundedAmount,
    deliverable,
    completionReason,
    status,
    statusLabel,
    createdAt,
    legacyAliases: {
      worker: provider,
      jobSpecHash: description,
      deliverableURI: deliverable,
      proofMetadataURI: completionReason,
      approved: status === 3,
    },
  };
}

// ── Agent normalizer ───────────────────────────────────────────────────────

/**
 * Normalize a Goldsky ProjectedAgent (or any agent-like object) to PM2 format.
 *
 * PM2 agentId format: "source:tokenId" (e.g. "erc8004_identity_registry:42")
 * Goldsky agentId format: raw number string (e.g. "42")
 *
 * If the input already has `displayType`, it's PM2 format and passed through.
 */
export function normalizeAgent(agent: Record<string, unknown>): NormalizedAgent {
  const rawAgentId = String(agent.agentId ?? "");
  const tokenId = String(agent.tokenId ?? rawAgentId);
  const controller = String(agent.controller ?? ZERO_ADDRESS);
  const metadataURI = String(agent.metadataURI ?? "");
  const source = String(agent.source ?? "erc8004_identity_registry");
  const transactionHash = String(agent.transactionHash ?? agent.txHash ?? "");
  const blockNumber = String(agent.blockNumber ?? agent.registeredAtBlock ?? "");
  const registeredAt = String(agent.registeredAt ?? agent.registeredAtBlock ?? blockNumber);
  const registeredAtBlock = String(agent.registeredAtBlock ?? registeredAt);
  const now = new Date().toISOString();

  // If PM2 format (already has displayType), pass through
  if (agent.displayType) {
    return agent as unknown as NormalizedAgent;
  }

  // Goldsky/SDK format → synthesize PM2-compatible shape
  const agentId = rawAgentId.includes(":")
    ? rawAgentId
    : `${source}:${rawAgentId}`;

  return {
    agentId,
    tokenId,
    controller,
    skillHash: String(agent.skillHash ?? ZERO_BYTES32),
    metadataURI,
    registeredAt,
    registeredAtBlock,
    reputationScore: String(agent.reputationScore ?? "0"),
    score: String(agent.score ?? "0"),
    jobs: Array.isArray(agent.jobs) ? (agent.jobs as string[]) : [],
    proofTokenIds: Array.isArray(agent.proofTokenIds) ? (agent.proofTokenIds as string[]) : [],
    source,
    chainId: String(agent.chainId ?? "5042002"),
    registryAddress: String(agent.registryAddress ?? ""),
    contractAddress: String(agent.contractAddress ?? ""),
    transactionHash,
    txHash: transactionHash,
    blockNumber,
    importedAt: String(agent.importedAt ?? now),
    updatedAt: String(agent.updatedAt ?? now),
    displayType: "ERC-8004 Agent",
  };
}

// ── Overview normalizer ────────────────────────────────────────────────────

/**
 * Normalize a Goldsky OverviewProjection (or PM2 overview) to PM2 format.
 *
 * PM2 overview includes `meta`, `agentBreakdown`, `jobBreakdown` which
 * the SDK's buildOverviewAggregation doesn't produce.
 */
export function normalizeOverview(overview: Record<string, unknown>): NormalizedOverview {
  const summary = (overview.summary ?? {}) as Record<string, unknown>;
  const jobs = Array.isArray(overview.jobs) ? overview.jobs : [];
  const agents = Array.isArray(overview.agents) ? overview.agents : [];
  const proofs = Array.isArray(overview.proofs) ? overview.proofs : [];

  const normalizedJobs = jobs.map((j) => normalizeJob(j as Record<string, unknown>));
  const normalizedAgents = agents.map((a) => normalizeAgent(a as Record<string, unknown>));

  const importedAgentCount = normalizedAgents.filter((a) => a.source === "imported_arclayer_registry").length;
  const erc8004AgentCount = normalizedAgents.filter((a) => a.source === "erc8004_identity_registry").length;
  const totalAgents = normalizedAgents.length;

  // If PM2 format (already has meta), pass through with normalized sub-objects
  if (summary.meta && typeof summary.meta === "object") {
    return {
      summary: {
        eventCount: Number(summary.eventCount ?? 0),
        jobs: normalizedJobs.length,
        agents: totalAgents,
        meta: summary.meta as NormalizedOverview["summary"]["meta"],
        agentBreakdown: (summary.agentBreakdown as NormalizedOverview["summary"]["agentBreakdown"]) ?? {
          importedAgentCount,
          erc8004AgentCount,
          totalAgentCount: totalAgents,
        },
        jobBreakdown: (summary.jobBreakdown as NormalizedOverview["summary"]["jobBreakdown"]) ?? {
          erc8183: normalizedJobs.length,
        },
        proofs: Number(summary.proofs ?? proofs.length),
        budgetedUsdc: String(summary.budgetedUsdc ?? "0"),
        fundedUsdc: String(summary.fundedUsdc ?? "0"),
        totalBudgetAtomic: String(summary.totalBudgetAtomic ?? "0"),
        totalFundedAtomic: String(summary.totalFundedAtomic ?? "0"),
        totalBudget: String(summary.totalBudget ?? "0"),
        totalFunded: String(summary.totalFunded ?? "0"),
        settledJobs: Number(summary.settledJobs ?? 0),
        fundedJobs: Number(summary.fundedJobs ?? 0),
      },
      jobs: normalizedJobs,
      agents: normalizedAgents,
      proofs,
    };
  }

  // Goldsky/SDK format → synthesize PM2-compatible summary
  return {
    summary: {
      eventCount: Number(summary.eventCount ?? 0),
      jobs: normalizedJobs.length,
      agents: totalAgents,
      meta: {
        importedAgentCount,
        erc8004AgentCount,
      },
      agentBreakdown: {
        importedAgentCount,
        erc8004AgentCount,
        totalAgentCount: totalAgents,
      },
      jobBreakdown: {
        erc8183: normalizedJobs.length,
      },
      proofs: proofs.length,
      budgetedUsdc: String(summary.budgetedUsdc ?? "0"),
      fundedUsdc: String(summary.fundedUsdc ?? "0"),
      totalBudgetAtomic: String(summary.totalBudgetAtomic ?? "0"),
      totalFundedAtomic: String(summary.totalFundedAtomic ?? "0"),
      totalBudget: String(summary.totalBudget ?? "0"),
      totalFunded: String(summary.totalFunded ?? "0"),
      settledJobs: Number(summary.settledJobs ?? 0),
      fundedJobs: Number(summary.fundedJobs ?? 0),
    },
    jobs: normalizedJobs,
    agents: normalizedAgents,
    proofs,
  };
}

// ── Job detail normalizer ──────────────────────────────────────────────────

/** Normalize a job detail response (PM2 or Goldsky) to PM2 format. */
export function normalizeJobDetail(detail: Record<string, unknown>): NormalizedJobDetail {
  const job = normalizeJob((detail.job ?? detail) as Record<string, unknown>);
  const proof = detail.proof ?? null;
  return {
    job,
    proof: proof as NormalizedJobDetail["proof"],
  };
}

// ── Agent detail normalizer ────────────────────────────────────────────────

/** Normalize an agent detail response (PM2 or Goldsky) to PM2 format. */
export function normalizeAgentDetail(detail: Record<string, unknown>): NormalizedAgentDetail {
  const agent = normalizeAgent((detail.agent ?? detail) as Record<string, unknown>);
  const jobs = Array.isArray(detail.jobs)
    ? detail.jobs.map((j) => normalizeJob(j as Record<string, unknown>))
    : [];
  const proofs = Array.isArray(detail.proofs) ? detail.proofs : [];
  return { agent, jobs, proofs };
}
