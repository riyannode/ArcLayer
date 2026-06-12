import { describe, it, expect } from "vitest";
import {
  normalizeJob,
  normalizeAgent,
  normalizeOverview,
  normalizeJobDetail,
  normalizeAgentDetail,
} from "./indexer-response-normalizer";

// ── Fixtures ───────────────────────────────────────────────────────────────

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** PM2 job shape (from indexer/src/db.ts readJobsFiltered). */
const pm2Job = {
  id: "1",
  client: "0x1111111111111111111111111111111111111111",
  provider: "0x2222222222222222222222222222222222222222",
  evaluator: "0x3333333333333333333333333333333333333333",
  description: "Test job description",
  budget: "1000000",
  fundedAmount: "500000",
  deliverable: "0xabcdef",
  completionReason: "0xdeadbeef",
  status: 3,
  statusLabel: "Completed",
  createdAt: "41752100",
  legacyAliases: {
    worker: "0x2222222222222222222222222222222222222222",
    jobSpecHash: "Test job description",
    deliverableURI: "0xabcdef",
    proofMetadataURI: "0xdeadbeef",
    approved: true,
  },
};

/** Goldsky ProjectedJob shape (from SDK projections). */
const goldskyJob = {
  id: "1",
  client: "0x1111111111111111111111111111111111111111",
  provider: "0x2222222222222222222222222222222222222222",
  evaluator: "0x3333333333333333333333333333333333333333",
  hook: "0x0000000000000000000000000000000000000000",
  expiredAt: "0",
  description: "Test job description",
  budget: "1000000",
  fundedAmount: "500000",
  createdAtBlock: "41752100",
  updatedAtBlock: "41752200",
  deliverable: "0xabcdef",
  completionReason: "0xdeadbeef",
  rejector: undefined,
  status: 3,
  statusLabel: "Completed",
  createdAt: "41752100",
  events: [],
};

/** PM2 agent shape (from indexer/src/db.ts readAgents). */
const pm2Agent = {
  agentId: "erc8004_identity_registry:42",
  tokenId: "42",
  controller: "0x2222222222222222222222222222222222222222",
  skillHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  metadataURI: "arclayer://agent/42",
  registeredAt: "41752100",
  registeredAtBlock: "41752100",
  reputationScore: "0",
  score: "0",
  jobs: [],
  proofTokenIds: [],
  source: "erc8004_identity_registry",
  chainId: "5042002",
  registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  contractAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  transactionHash: "0xaaaa",
  txHash: "0xaaaa",
  blockNumber: "41752100",
  importedAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  displayType: "ERC-8004 Agent",
};

/** Goldsky ProjectedAgent shape (from SDK projections). */
const goldskyAgent = {
  agentId: "42",
  tokenId: "42",
  controller: "0x2222222222222222222222222222222222222222",
  metadataURI: "arclayer://agent/42",
  registeredAtBlock: "41752100",
  transactionHash: "0xaaaa",
  source: "erc8004_identity_registry",
  chainId: 5042002,
  registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  contractAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};

// ── normalizeJob tests ─────────────────────────────────────────────────────

describe("normalizeJob", () => {
  it("PM2 format passes through with legacyAliases preserved", () => {
    const result = normalizeJob(pm2Job);
    expect(result.id).toBe("1");
    expect(result.provider).toBe(pm2Job.provider);
    expect(result.legacyAliases.worker).toBe(pm2Job.provider);
    expect(result.legacyAliases.approved).toBe(true);
    expect(result.legacyAliases.jobSpecHash).toBe("Test job description");
  });

  it("Goldsky format gets legacyAliases synthesized", () => {
    const result = normalizeJob(goldskyJob);
    expect(result.id).toBe("1");
    expect(result.provider).toBe(goldskyJob.provider);
    expect(result.description).toBe("Test job description");
    expect(result.legacyAliases.worker).toBe(goldskyJob.provider);
    expect(result.legacyAliases.jobSpecHash).toBe(goldskyJob.description);
    expect(result.legacyAliases.deliverableURI).toBe(goldskyJob.deliverable);
    expect(result.legacyAliases.proofMetadataURI).toBe(goldskyJob.completionReason);
    expect(result.legacyAliases.approved).toBe(true); // status === 3
  });

  it("Goldsky format without legacyAliases does not leak SDK-only fields", () => {
    const result = normalizeJob(goldskyJob);
    // hook, expiredAt, updatedAtBlock, rejector, events should NOT be in output
    expect(result).not.toHaveProperty("hook");
    expect(result).not.toHaveProperty("expiredAt");
    expect(result).not.toHaveProperty("updatedAtBlock");
    expect(result).not.toHaveProperty("rejector");
    expect(result).not.toHaveProperty("events");
  });

  it("handles missing fields gracefully with defaults", () => {
    const minimal = { id: "99" };
    const result = normalizeJob(minimal);
    expect(result.id).toBe("99");
    expect(result.client).toBe(ZERO_ADDR);
    expect(result.budget).toBe("0");
    expect(result.status).toBe(0);
    expect(result.legacyAliases.approved).toBe(false);
  });

  it("status 0 (Open) produces approved=false", () => {
    const openJob = { ...goldskyJob, status: 0, statusLabel: "Open" };
    const result = normalizeJob(openJob);
    expect(result.legacyAliases.approved).toBe(false);
  });
});

// ── normalizeAgent tests ───────────────────────────────────────────────────

describe("normalizeAgent", () => {
  it("PM2 format passes through with displayType preserved", () => {
    const result = normalizeAgent(pm2Agent);
    expect(result.agentId).toBe("erc8004_identity_registry:42");
    expect(result.displayType).toBe("ERC-8004 Agent");
    expect(result.reputationScore).toBe("0");
    expect(result.chainId).toBe("5042002");
  });

  it("Goldsky format gets source:tokenId agentId prefix", () => {
    const result = normalizeAgent(goldskyAgent);
    expect(result.agentId).toBe("erc8004_identity_registry:42");
    expect(result.tokenId).toBe("42");
    expect(result.displayType).toBe("ERC-8004 Agent");
  });

  it("Goldsky format gets missing fields synthesized", () => {
    const result = normalizeAgent(goldskyAgent);
    expect(result.reputationScore).toBe("0");
    expect(result.score).toBe("0");
    expect(result.jobs).toEqual([]);
    expect(result.proofTokenIds).toEqual([]);
    expect(result.txHash).toBe(goldskyAgent.transactionHash);
    expect(result.registeredAt).toBe(goldskyAgent.registeredAtBlock);
    expect(result.registeredAtBlock).toBe(goldskyAgent.registeredAtBlock);
  });

  it("Goldsky chainId number is normalized to string", () => {
    const result = normalizeAgent(goldskyAgent);
    expect(typeof result.chainId).toBe("string");
    expect(result.chainId).toBe("5042002");
  });

  it("agentId already containing colon is not double-prefixed", () => {
    const alreadyPrefixed = { ...goldskyAgent, agentId: "erc8004_identity_registry:42" };
    const result = normalizeAgent(alreadyPrefixed);
    expect(result.agentId).toBe("erc8004_identity_registry:42");
  });

  it("handles missing fields gracefully with defaults", () => {
    const minimal = { agentId: "99" };
    const result = normalizeAgent(minimal);
    expect(result.agentId).toBe("erc8004_identity_registry:99");
    expect(result.tokenId).toBe("99");
    expect(result.controller).toBe(ZERO_ADDR);
    expect(result.skillHash).toBe(ZERO_BYTES32);
    expect(result.displayType).toBe("ERC-8004 Agent");
  });
});

// ── normalizeOverview tests ────────────────────────────────────────────────

describe("normalizeOverview", () => {
  it("PM2 format passes through with meta preserved", () => {
    const pm2Overview = {
      summary: {
        eventCount: 100,
        jobs: 5,
        agents: 3,
        meta: { importedAgentCount: 0, erc8004AgentCount: 3 },
        agentBreakdown: { importedAgentCount: 0, erc8004AgentCount: 3, totalAgentCount: 3 },
        jobBreakdown: { erc8183: 5 },
        proofs: 0,
        budgetedUsdc: "1.0",
        fundedUsdc: "0.5",
        totalBudgetAtomic: "1000000",
        totalFundedAtomic: "500000",
        totalBudget: "1000000",
        totalFunded: "500000",
        settledJobs: 2,
        fundedJobs: 3,
      },
      jobs: [pm2Job],
      agents: [pm2Agent],
      proofs: [],
    };
    const result = normalizeOverview(pm2Overview);
    expect(result.summary.meta.importedAgentCount).toBe(0);
    expect(result.summary.meta.erc8004AgentCount).toBe(3);
    expect(result.summary.agentBreakdown.totalAgentCount).toBe(3);
    expect(result.jobs).toHaveLength(1);
    expect(result.agents).toHaveLength(1);
  });

  it("Goldsky format gets meta/agentBreakdown/jobBreakdown synthesized", () => {
    const goldskyOverview = {
      summary: {
        eventCount: 100,
        jobs: 5,
        agents: 3,
        proofs: 0,
        budgetedUsdc: "1.0",
        fundedUsdc: "0.5",
        totalBudgetAtomic: "1000000",
        totalFundedAtomic: "500000",
        totalBudget: "1000000",
        totalFunded: "500000",
        settledJobs: 2,
        fundedJobs: 3,
      },
      jobs: [goldskyJob],
      agents: [goldskyAgent],
      proofs: [],
    };
    const result = normalizeOverview(goldskyOverview);
    expect(result.summary.meta).toBeDefined();
    expect(result.summary.meta.erc8004AgentCount).toBe(1);
    expect(result.summary.agentBreakdown).toBeDefined();
    expect(result.summary.agentBreakdown.totalAgentCount).toBe(1);
    expect(result.summary.jobBreakdown).toBeDefined();
    expect(result.summary.jobBreakdown.erc8183).toBe(1);
  });

  it("handles empty arrays gracefully", () => {
    const empty = { summary: {}, jobs: [], agents: [], proofs: [] };
    const result = normalizeOverview(empty);
    expect(result.summary.jobs).toBe(0);
    expect(result.summary.agents).toBe(0);
    expect(result.jobs).toEqual([]);
    expect(result.agents).toEqual([]);
  });
});

// ── normalizeJobDetail tests ───────────────────────────────────────────────

describe("normalizeJobDetail", () => {
  it("normalizes job and preserves proof", () => {
    const detail = {
      job: goldskyJob,
      proof: { tokenId: "1", jobId: "1", agentId: "42", payer: ZERO_ADDR, amountPaid: "0", mintedAt: "0", metadataURI: "" },
    };
    const result = normalizeJobDetail(detail);
    expect(result.job.id).toBe("1");
    expect(result.job.legacyAliases).toBeDefined();
    expect(result.proof).not.toBeNull();
    expect(result.proof!.tokenId).toBe("1");
  });

  it("handles null proof", () => {
    const detail = { job: goldskyJob, proof: null };
    const result = normalizeJobDetail(detail);
    expect(result.proof).toBeNull();
  });
});

// ── normalizeAgentDetail tests ─────────────────────────────────────────────

describe("normalizeAgentDetail", () => {
  it("normalizes agent and nested jobs", () => {
    const detail = {
      agent: goldskyAgent,
      jobs: [goldskyJob],
      proofs: [],
    };
    const result = normalizeAgentDetail(detail);
    expect(result.agent.agentId).toBe("erc8004_identity_registry:42");
    expect(result.agent.displayType).toBe("ERC-8004 Agent");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].legacyAliases).toBeDefined();
    expect(result.proofs).toEqual([]);
  });
});
