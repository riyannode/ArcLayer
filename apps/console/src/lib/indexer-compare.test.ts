import { describe, it, expect } from "vitest";
import {
  compareHealth,
  compareCounts,
  compareIdSets,
  compareJobFields,
  compareAgentFields,
  compareOverviewCounts,
  normalizeAgentIdForMatch,
  buildComparisonReport,
} from "./indexer-compare";
import type { NormalizedJob, NormalizedAgent, NormalizedOverview } from "./indexer-response-normalizer";

// ── Fixtures ───────────────────────────────────────────────────────────────

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

function makeJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: "1",
    client: "0x1111111111111111111111111111111111111111",
    provider: "0x2222222222222222222222222222222222222222",
    evaluator: "0x3333333333333333333333333333333333333333",
    hook: ZERO_ADDR,
    expiredAt: "0",
    description: "Test job",
    budget: "1000000",
    fundedAmount: "500000",
    createdAtBlock: "41752100",
    updatedAtBlock: "41752100",
    deliverable: "0xabcdef",
    completionReason: "0xdeadbeef",
    status: 3,
    statusLabel: "Completed",
    createdAt: "41752100",
    worker: "0x2222222222222222222222222222222222222222",
    agentId: "0x2222222222222222222222222222222222222222",
    jobSpecHash: "Test job",
    deliverableURI: "0xabcdef",
    proofMetadataURI: "",
    approved: true,
    legacyAliases: {
      worker: "0x2222222222222222222222222222222222222222",
      jobSpecHash: "Test job",
      deliverableURI: "0xabcdef",
      proofMetadataURI: "",
      approved: true,
    },
    ...overrides,
  };
}

function makeAgent(overrides: Partial<NormalizedAgent> = {}): NormalizedAgent {
  return {
    agentId: "erc8004_identity_registry:42",
    tokenId: "42",
    controller: "0x2222222222222222222222222222222222222222",
    skillHash: "0x0000",
    metadataURI: "https://arclayers.xyz/agent/42",
    registeredAt: "41752100",
    registeredAtBlock: "41752100",
    reputationScore: "0",
    score: "0",
    jobs: [],
    proofTokenIds: [],
    source: "erc8004_identity_registry",
    chainId: "5042002",
    registryAddress: "",
    contractAddress: "",
    transactionHash: "0xabc",
    txHash: "0xabc",
    blockNumber: "41752100",
    importedAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    displayType: "ERC-8004 Agent",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("compareHealth", () => {
  it("returns both providers ok when healthy", () => {
    const result = compareHealth(
      { ok: true, lastSyncedBlock: 41752200 },
      { ok: true },
    );
    expect(result.custom.ok).toBe(true);
    expect(result.goldsky.ok).toBe(true);
    expect(result.custom.lastSyncedBlock).toBe(41752200);
  });

  it("captures errors from either provider", () => {
    const result = compareHealth(
      { ok: false, lastSyncError: "RPC timeout" },
      { ok: false, error: "Supabase unreachable" },
    );
    expect(result.custom.ok).toBe(false);
    expect(result.custom.error).toBe("RPC timeout");
    expect(result.goldsky.ok).toBe(false);
    expect(result.goldsky.error).toBe("Supabase unreachable");
  });
});

describe("compareCounts", () => {
  it("returns 0 diff when counts match", () => {
    const result = compareCounts("jobs", 5, 5);
    expect(result.diff).toBe(0);
  });

  it("returns positive diff when goldsky has more", () => {
    const result = compareCounts("agents", 3, 5);
    expect(result.diff).toBe(2);
  });

  it("returns negative diff when custom has more", () => {
    const result = compareCounts("jobs", 8, 5);
    expect(result.diff).toBe(-3);
  });
});

describe("compareIdSets", () => {
  it("returns empty arrays when sets match", () => {
    const result = compareIdSets(["1", "2", "3"], ["1", "2", "3"]);
    expect(result.onlyInCustom).toEqual([]);
    expect(result.onlyInGoldsky).toEqual([]);
  });

  it("detects IDs only in custom", () => {
    const result = compareIdSets(["1", "2", "3"], ["1", "2"]);
    expect(result.onlyInCustom).toEqual(["3"]);
    expect(result.onlyInGoldsky).toEqual([]);
  });

  it("detects IDs only in goldsky", () => {
    const result = compareIdSets(["1"], ["1", "2", "4"]);
    expect(result.onlyInCustom).toEqual([]);
    expect(result.onlyInGoldsky).toEqual(["2", "4"]);
  });

  it("detects IDs in both directions", () => {
    const result = compareIdSets(["1", "3"], ["2", "3"]);
    expect(result.onlyInCustom).toEqual(["1"]);
    expect(result.onlyInGoldsky).toEqual(["2"]);
  });
});

describe("normalizeAgentIdForMatch", () => {
  it("strips source prefix", () => {
    expect(normalizeAgentIdForMatch("erc8004_identity_registry:42")).toBe("42");
  });

  it("returns raw ID as-is", () => {
    expect(normalizeAgentIdForMatch("42")).toBe("42");
  });

  it("handles source prefix variations", () => {
    expect(normalizeAgentIdForMatch("imported_arclayer_registry:7")).toBe("7");
  });
});

describe("compareJobFields", () => {
  it("returns no diffs when jobs are identical", () => {
    const custom = [makeJob()];
    const goldsky = [makeJob()];
    const diffs = compareJobFields(custom, goldsky);
    expect(diffs).toEqual([]);
  });

  it("detects status mismatch", () => {
    const custom = [makeJob({ status: 3 })];
    const goldsky = [makeJob({ status: 2 })];
    const diffs = compareJobFields(custom, goldsky);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.some((d) => d.field === "status")).toBe(true);
  });

  it("detects provider mismatch", () => {
    const custom = [makeJob({ provider: "0xAAA" })];
    const goldsky = [makeJob({ provider: "0xBBB" })];
    const diffs = compareJobFields(custom, goldsky);
    expect(diffs.some((d) => d.field === "provider")).toBe(true);
  });

  it("skips jobs missing from goldsky", () => {
    const custom = [makeJob({ id: "1" }), makeJob({ id: "2" })];
    const goldsky = [makeJob({ id: "1" })];
    const diffs = compareJobFields(custom, goldsky);
    // Job "2" is missing entirely, not a field diff
    expect(diffs.filter((d) => d.id === "2")).toEqual([]);
  });

  it("ignores jobs only in goldsky", () => {
    const custom = [makeJob({ id: "1" })];
    const goldsky = [makeJob({ id: "1" }), makeJob({ id: "3" })];
    const diffs = compareJobFields(custom, goldsky);
    expect(diffs).toEqual([]);
  });
});

describe("compareAgentFields", () => {
  it("returns no diffs when agents match (normalizing IDs)", () => {
    const custom = [makeAgent({ agentId: "erc8004_identity_registry:42" })];
    const goldsky = [makeAgent({ agentId: "42" })];
    const diffs = compareAgentFields(custom, goldsky);
    expect(diffs).toEqual([]);
  });

  it("detects controller mismatch", () => {
    const custom = [makeAgent({ controller: "0xAAA" })];
    const goldsky = [makeAgent({ controller: "0xBBB" })];
    const diffs = compareAgentFields(custom, goldsky);
    expect(diffs.some((d) => d.field === "controller")).toBe(true);
  });

  it("detects metadataURI mismatch", () => {
    const custom = [makeAgent({ metadataURI: "https://old.example" })];
    const goldsky = [makeAgent({ metadataURI: "https://new.example" })];
    const diffs = compareAgentFields(custom, goldsky);
    expect(diffs.some((d) => d.field === "metadataURI")).toBe(true);
  });
});

describe("compareOverviewCounts", () => {
  it("returns 0 diffs when overviews match", () => {
    const overview: NormalizedOverview = {
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
      jobs: [],
      agents: [],
      proofs: [],
    };

    const result = compareOverviewCounts(overview, overview);
    expect(result.overviewJobs.diff).toBe(0);
    expect(result.overviewAgents.diff).toBe(0);
    expect(result.overviewSettled.diff).toBe(0);
    expect(result.overviewFunded.diff).toBe(0);
  });
});

describe("buildComparisonReport", () => {
  const baseParams = {
    customHealth: { ok: true, lastSyncedBlock: 41752200 } as Record<string, unknown>,
    goldskyHealth: { ok: true } as Record<string, unknown>,
    customJobs: [] as Record<string, unknown>[],
    goldskyJobs: [] as Record<string, unknown>[],
    customAgents: [] as Record<string, unknown>[],
    goldskyAgents: [] as Record<string, unknown>[],
    customProofs: [] as Record<string, unknown>[],
    goldskyProofs: [] as Record<string, unknown>[],
    customOverview: { summary: { jobs: 0, agents: 0, settledJobs: 0, fundedJobs: 0 }, jobs: [], agents: [], proofs: [] } as Record<string, unknown>,
    goldskyOverview: { summary: { jobs: 0, agents: 0, settledJobs: 0, fundedJobs: 0 }, jobs: [], agents: [], proofs: [] } as Record<string, unknown>,
  };

  it("reports MATCH when both providers are identical and empty", () => {
    const report = buildComparisonReport(baseParams);
    expect(report.verdict).toContain("MATCH");
    expect(report.counts.jobs.diff).toBe(0);
    expect(report.counts.agents.diff).toBe(0);
  });

  it("reports DIVERGENCE when job counts differ", () => {
    const report = buildComparisonReport({
      ...baseParams,
      customJobs: [makeJob({ id: "1" }) as unknown as Record<string, unknown>],
      customOverview: {
        summary: { jobs: 1, agents: 0, settledJobs: 0, fundedJobs: 0 },
        jobs: [makeJob({ id: "1" })],
        agents: [],
        proofs: [],
      } as unknown as Record<string, unknown>,
    });
    expect(report.verdict).toContain("DIVERGENCE");
    expect(report.verdict).toContain("job count mismatch");
  });

  it("reports missing job IDs", () => {
    const report = buildComparisonReport({
      ...baseParams,
      customJobs: [makeJob({ id: "1" }) as unknown as Record<string, unknown>],
      customOverview: {
        summary: { jobs: 1, agents: 0, settledJobs: 0, fundedJobs: 0 },
        jobs: [makeJob({ id: "1" })],
        agents: [],
        proofs: [],
      } as unknown as Record<string, unknown>,
    });
    expect(report.missing.jobIdsInCustomOnly).toEqual(["1"]);
  });

  it("includes block lag from custom provider", () => {
    const report = buildComparisonReport(baseParams);
    expect(report.blockLag.customBlock).toBe(41752200);
  });

  it("includes generatedAt timestamp", () => {
    const report = buildComparisonReport(baseParams);
    expect(report.generatedAt).toBeTruthy();
    expect(new Date(report.generatedAt).getTime()).not.toBeNaN();
  });
});
