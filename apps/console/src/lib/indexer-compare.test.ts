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

function makeOverview(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: {
      jobs: 0,
      agents: 0,
      settledJobs: 0,
      fundedJobs: 0,
      eventCount: 0,
      meta: { importedAgentCount: 0, erc8004AgentCount: 0 },
      agentBreakdown: { importedAgentCount: 0, erc8004AgentCount: 0, totalAgentCount: 0 },
      jobBreakdown: { erc8183: 0 },
      proofs: 0,
      budgetedUsdc: "0",
      fundedUsdc: "0",
      totalBudgetAtomic: "0",
      totalFundedAtomic: "0",
      totalBudget: "0",
      totalFunded: "0",
      ...overrides,
    },
    jobs: [],
    agents: [],
    proofs: [],
  };
}

// ── Tests: compareHealth ───────────────────────────────────────────────────

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

  it("returns stable error codes, not raw text", () => {
    const result = compareHealth(
      { ok: false, lastSyncError: "RPC timeout at drpc.testnet.arc.network" },
      { ok: false, error: "Supabase connection refused: postgres://..." },
    );
    expect(result.custom.ok).toBe(false);
    expect(result.custom.error).toBe("custom_sync_error");
    expect(result.goldsky.ok).toBe(false);
    expect(result.goldsky.error).toBe("goldsky_reader_error");
  });
});

// ── Tests: compareCounts ───────────────────────────────────────────────────

describe("compareCounts", () => {
  it("returns 0 diff when counts match", () => {
    expect(compareCounts("jobs", 5, 5).diff).toBe(0);
  });

  it("returns positive diff when goldsky has more", () => {
    expect(compareCounts("agents", 3, 5).diff).toBe(2);
  });

  it("returns negative diff when custom has more", () => {
    expect(compareCounts("jobs", 8, 5).diff).toBe(-3);
  });
});

// ── Tests: compareIdSets ───────────────────────────────────────────────────

describe("compareIdSets", () => {
  it("returns empty arrays when sets match", () => {
    const result = compareIdSets(["1", "2", "3"], ["1", "2", "3"]);
    expect(result.onlyInCustom).toEqual([]);
    expect(result.onlyInGoldsky).toEqual([]);
  });

  it("detects IDs only in custom", () => {
    expect(compareIdSets(["1", "2", "3"], ["1", "2"]).onlyInCustom).toEqual(["3"]);
  });

  it("detects IDs only in goldsky", () => {
    expect(compareIdSets(["1"], ["1", "2", "4"]).onlyInGoldsky).toEqual(["2", "4"]);
  });
});

// ── Tests: normalizeAgentIdForMatch ────────────────────────────────────────

describe("normalizeAgentIdForMatch", () => {
  it("strips source prefix", () => {
    expect(normalizeAgentIdForMatch("erc8004_identity_registry:42")).toBe("42");
  });

  it("returns raw ID as-is", () => {
    expect(normalizeAgentIdForMatch("42")).toBe("42");
  });
});

// ── Tests: compareJobFields ────────────────────────────────────────────────

describe("compareJobFields", () => {
  it("returns no diffs when jobs are identical", () => {
    expect(compareJobFields([makeJob()], [makeJob()])).toEqual([]);
  });

  it("detects status mismatch", () => {
    const diffs = compareJobFields([makeJob({ status: 3 })], [makeJob({ status: 2 })]);
    expect(diffs.some((d) => d.field === "status")).toBe(true);
  });

  it("detects provider mismatch", () => {
    const diffs = compareJobFields(
      [makeJob({ provider: "0xAAA" })],
      [makeJob({ provider: "0xBBB" })],
    );
    expect(diffs.some((d) => d.field === "provider")).toBe(true);
  });

  it("detects deliverable mismatch", () => {
    const diffs = compareJobFields(
      [makeJob({ deliverable: "0xaaa" })],
      [makeJob({ deliverable: "0xbbb" })],
    );
    expect(diffs.some((d) => d.field === "deliverable")).toBe(true);
  });

  it("detects completionReason mismatch", () => {
    const diffs = compareJobFields(
      [makeJob({ completionReason: "0x111" })],
      [makeJob({ completionReason: "0x222" })],
    );
    expect(diffs.some((d) => d.field === "completionReason")).toBe(true);
  });

  it("compares addresses case-insensitively", () => {
    const diffs = compareJobFields(
      [makeJob({ client: "0xAAA" })],
      [makeJob({ client: "0xaaa" })],
    );
    expect(diffs).toEqual([]);
  });

  it("skips jobs missing from goldsky", () => {
    const diffs = compareJobFields(
      [makeJob({ id: "1" }), makeJob({ id: "2" })],
      [makeJob({ id: "1" })],
    );
    expect(diffs.filter((d) => d.id === "2")).toEqual([]);
  });
});

// ── Tests: compareAgentFields ──────────────────────────────────────────────

describe("compareAgentFields", () => {
  it("returns no diffs when agents match (normalizing IDs)", () => {
    const custom = [makeAgent({ agentId: "erc8004_identity_registry:42" })];
    const goldsky = [makeAgent({ agentId: "erc8004_identity_registry:42" })];
    expect(compareAgentFields(custom, goldsky)).toEqual([]);
  });

  it("detects controller mismatch", () => {
    const diffs = compareAgentFields(
      [makeAgent({ controller: "0xAAA" })],
      [makeAgent({ controller: "0xBBB" })],
    );
    expect(diffs.some((d) => d.field === "controller")).toBe(true);
  });

  it("compares controller addresses case-insensitively", () => {
    const diffs = compareAgentFields(
      [makeAgent({ controller: "0xAAA" })],
      [makeAgent({ controller: "0xaaa" })],
    );
    expect(diffs).toEqual([]);
  });

  it("does NOT match imported agent to erc8004 agent with same tokenId", () => {
    const imported = makeAgent({
      agentId: "imported_arclayer_registry:7",
      source: "imported_arclayer_registry",
    });
    const erc8004 = makeAgent({
      agentId: "erc8004_identity_registry:7",
      source: "erc8004_identity_registry",
    });
    // Different sources = different match keys, so no field diffs expected
    const diffs = compareAgentFields([imported], [erc8004]);
    expect(diffs).toEqual([]);
  });
});

// ── Tests: compareOverviewCounts ───────────────────────────────────────────

describe("compareOverviewCounts", () => {
  it("returns 0 diffs when overviews match", () => {
    const overview = makeOverview({
      jobs: 5,
      agents: 3,
      settledJobs: 2,
      fundedJobs: 3,
    }) as unknown as NormalizedOverview;
    const result = compareOverviewCounts(overview, overview);
    expect(result.overviewJobs.diff).toBe(0);
    expect(result.overviewAgents.diff).toBe(0);
    expect(result.overviewSettled.diff).toBe(0);
    expect(result.overviewFunded.diff).toBe(0);
  });
});

// ── Tests: buildComparisonReport ───────────────────────────────────────────

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
    customOverview: makeOverview(),
    goldskyOverview: makeOverview(),
  };

  it("reports MATCH when both providers are identical and empty", () => {
    const report = buildComparisonReport(baseParams);
    expect(report.verdict).toContain("MATCH");
    expect(report.counts.jobs.diff).toBe(0);
  });

  it("reports DIVERGENCE when job counts differ", () => {
    const report = buildComparisonReport({
      ...baseParams,
      customJobs: [makeJob({ id: "1" }) as unknown as Record<string, unknown>],
      customOverview: makeOverview({ jobs: 1 }),
    });
    expect(report.verdict).toContain("DIVERGENCE");
    expect(report.verdict).toContain("job count mismatch");
  });

  it("reports missing agent IDs in verdict", () => {
    const report = buildComparisonReport({
      ...baseParams,
      customAgents: [
        makeAgent({ agentId: "erc8004_identity_registry:1" }) as unknown as Record<string, unknown>,
      ],
    });
    expect(report.verdict).toContain("agents missing from goldsky");
  });

  it("reports proof count mismatch in verdict", () => {
    const report = buildComparisonReport({
      ...baseParams,
      customProofs: [{ tokenId: "1" }] as Record<string, unknown>[],
    });
    expect(report.verdict).toContain("proof count mismatch");
  });

  it("reports overview settled mismatch in verdict", () => {
    const report = buildComparisonReport({
      ...baseParams,
      customOverview: makeOverview({ settledJobs: 5 }),
      goldskyOverview: makeOverview({ settledJobs: 3 }),
    });
    expect(report.verdict).toContain("overview settled count mismatch");
  });

  it("reports overview funded mismatch in verdict", () => {
    const report = buildComparisonReport({
      ...baseParams,
      customOverview: makeOverview({ fundedJobs: 2 }),
      goldskyOverview: makeOverview({ fundedJobs: 4 }),
    });
    expect(report.verdict).toContain("overview funded count mismatch");
  });

  it("includes block lag from custom provider", () => {
    const report = buildComparisonReport(baseParams);
    expect(report.blockLag.customBlock).toBe(41752200);
  });

  it("marks Goldsky block as unavailable when maxBlock is 0", () => {
    const report = buildComparisonReport({ ...baseParams, goldskyMaxBlock: 0 });
    expect(report.blockLag.goldskyBlockAvailable).toBe(false);
    expect(report.blockLag.lag).toBe(0);
  });

  it("derives Goldsky block from maxBlock param", () => {
    const report = buildComparisonReport({ ...baseParams, goldskyMaxBlock: 41752000 });
    expect(report.blockLag.goldskyBlock).toBe(41752000);
    expect(report.blockLag.goldskyBlockAvailable).toBe(true);
    expect(report.blockLag.lag).toBe(200); // 41752200 - 41752000
  });

  it("includes generatedAt timestamp", () => {
    const report = buildComparisonReport(baseParams);
    expect(report.generatedAt).toBeTruthy();
    expect(new Date(report.generatedAt).getTime()).not.toBeNaN();
  });
});
