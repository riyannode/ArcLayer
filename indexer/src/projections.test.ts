import test from "node:test";
import assert from "node:assert/strict";
import type { IndexedJobEvent, IndexedAgentEvent } from "@arclayer/sdk";
import {
  projectJobsFromEvents,
  projectAgentsFromEvents,
  buildOverviewProjection,
  buildAgentProjectionDebug,
  arcWalletFilterActive,
} from "./projections";
import {
  projectJobsFromEvents as sdkProjectJobs,
  projectAgentsFromEvents as sdkProjectAgents,
  buildOverviewAggregation,
  collectJobWallets,
  groupByJobId,
  groupByAgentKey,
  sourceForAgentEvent,
  dedupeAgentEvents,
  isImportedArcLayerAgent,
  matchesMetadataPrefix,
  JOB_STATUS_CODE,
  JOB_STATUS_PRIORITY,
} from "@arclayer/sdk";

const tx = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const client = "0x1111111111111111111111111111111111111111" as const;
const provider = "0x2222222222222222222222222222222222222222" as const;
const evaluator = "0x3333333333333333333333333333333333333333" as const;
const unrelatedWallet = "0x9999999999999999999999999999999999999999" as const;
const anotherWallet = "0x8888888888888888888888888888888888888888" as const;

function jobEvent(
  eventName: IndexedJobEvent["eventName"],
  extra: Record<string, unknown>,
): IndexedJobEvent {
  return {
    eventName,
    jobId: 42n,
    blockNumber: 100n,
    transactionHash: tx,
    logIndex: 0,
    ...extra,
  } as IndexedJobEvent;
}

function agentEvent(extra: Record<string, unknown>): IndexedAgentEvent {
  return {
    eventName: "AgentRegistered",
    blockNumber: 100n,
    transactionHash: tx,
    logIndex: 0,
    ...extra,
  } as IndexedAgentEvent;
}

// Deterministic allowlist for simulating arclayer scope at SDK level.
const ALLOWED_WALLETS = new Set([
  client.toLowerCase(),
  provider.toLowerCase(),
  evaluator.toLowerCase(),
]);

function arclayerJobFilter(created: IndexedJobEvent | undefined): boolean {
  const c = (created?.client ?? "").toLowerCase();
  const p = (created?.provider ?? "").toLowerCase();
  const e = (created?.evaluator ?? "").toLowerCase();
  return ALLOWED_WALLETS.has(c) || ALLOWED_WALLETS.has(p) || ALLOWED_WALLETS.has(e);
}

const METADATA_PREFIXES = ["arclayer://", "https://arclayers.xyz"];

function arclayerAgentFilter(event: IndexedAgentEvent): boolean {
  if (event.source === "imported_arclayer_registry") return true;
  if (ALLOWED_WALLETS.has((event.controller ?? "").toLowerCase())) return true;
  if (matchesMetadataPrefix(event.metadataURI, METADATA_PREFIXES)) return true;
  return false;
}

// ── SDK pure projection tests ──────────────────────────────────────────────

test("SDK: projectJobsFromEvents without filter includes all jobs", () => {
  const jobs = sdkProjectJobs([
    jobEvent("JobCreated", {
      client: unrelatedWallet,
      provider: unrelatedWallet,
      evaluator: unrelatedWallet,
      expiredAt: 0n,
      hook: "0x0000000000000000000000000000000000000000",
      description: "unrelated",
    }),
  ]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].description, "unrelated");
});

test("SDK: projectJobsFromEvents with filter excludes unrelated jobs", () => {
  const jobs = sdkProjectJobs(
    [
      jobEvent("JobCreated", {
        jobId: 1n,
        client,
        provider,
        evaluator,
        expiredAt: 0n,
        hook: "0x0000000000000000000000000000000000000000",
        description: "match",
      }),
      jobEvent("JobCreated", {
        jobId: 2n,
        client: unrelatedWallet,
        provider: unrelatedWallet,
        evaluator: unrelatedWallet,
        expiredAt: 0n,
        hook: "0x0000000000000000000000000000000000000000",
        description: "no-match",
      }),
    ],
    (created) => created?.client === client,
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].description, "match");
});

test("SDK: projectJobsFromEvents with allowlist filter keeps matching and excludes unrelated", () => {
  const jobs = sdkProjectJobs(
    [
      jobEvent("JobCreated", {
        jobId: 1n,
        client,
        provider,
        evaluator,
        expiredAt: 0n,
        hook: "0x0000000000000000000000000000000000000000",
        description: "arclayer-job",
      }),
      jobEvent("JobCreated", {
        jobId: 2n,
        client: anotherWallet,
        provider: anotherWallet,
        evaluator: anotherWallet,
        expiredAt: 0n,
        hook: "0x0000000000000000000000000000000000000000",
        description: "external-job",
      }),
      jobEvent("JobCreated", {
        jobId: 3n,
        client: unrelatedWallet,
        provider,
        evaluator: unrelatedWallet,
        expiredAt: 0n,
        hook: "0x0000000000000000000000000000000000000000",
        description: "provider-match",
      }),
    ],
    arclayerJobFilter,
  );
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].description, "arclayer-job");
  assert.equal(jobs[1].description, "provider-match");
});

test("SDK: agent projection with metadata prefix keeps arclayer:// agents", () => {
  const agents = sdkProjectAgents(
    [
      agentEvent({ agentId: 1n, controller: unrelatedWallet, metadataURI: "arclayer://agent/1" }),
      agentEvent({
        agentId: 2n,
        controller: unrelatedWallet,
        metadataURI: "https://arclayers.xyz/agent/2",
      }),
      agentEvent({
        agentId: 3n,
        controller: unrelatedWallet,
        metadataURI: "https://example.com/agent/3",
      }),
    ],
    (event) => matchesMetadataPrefix(event.metadataURI, METADATA_PREFIXES),
  );
  assert.equal(agents.length, 2);
  assert.equal(agents[0].metadataURI, "arclayer://agent/1");
  assert.equal(agents[1].metadataURI, "https://arclayers.xyz/agent/2");
});

test("SDK: agent projection without wallet/agentId/metadata match is excluded when filter returns false", () => {
  const agents = sdkProjectAgents(
    [
      agentEvent({
        agentId: 1n,
        controller: unrelatedWallet,
        metadataURI: "https://example.com/agent/1",
      }),
      agentEvent({
        agentId: 2n,
        controller: anotherWallet,
        metadataURI: "https://other.io/agent/2",
      }),
    ],
    arclayerAgentFilter,
  );
  assert.equal(agents.length, 0);
});

test("SDK: agent projection with controller wallet match keeps agent even without metadata prefix", () => {
  const agents = sdkProjectAgents(
    [
      agentEvent({
        agentId: 1n,
        controller: client,
        metadataURI: "https://example.com/no-prefix",
      }),
      agentEvent({
        agentId: 2n,
        controller: unrelatedWallet,
        metadataURI: "https://example.com/also-no",
      }),
    ],
    arclayerAgentFilter,
  );
  assert.equal(agents.length, 1);
  assert.equal(agents[0].controller, client);
});

test("SDK: agent projection with imported source always passes filter", () => {
  const agents = sdkProjectAgents(
    [
      {
        ...agentEvent({
          agentId: 1n,
          controller: unrelatedWallet,
          metadataURI: "https://example.com",
        }),
        source: "imported_arclayer_registry",
      },
    ] as IndexedAgentEvent[],
    arclayerAgentFilter,
  );
  assert.equal(agents.length, 1);
  assert.equal(agents[0].source, "imported_arclayer_registry");
});

test("SDK: matchesMetadataPrefix is pure and correct", () => {
  assert.equal(matchesMetadataPrefix("arclayer://agent/1", ["arclayer://"]), true);
  assert.equal(
    matchesMetadataPrefix("https://arclayers.xyz/agent/1", ["https://arclayers.xyz"]),
    true,
  );
  assert.equal(matchesMetadataPrefix("https://example.com", ["arclayer://"]), false);
  assert.equal(matchesMetadataPrefix(undefined, ["arclayer://"]), false);
  assert.equal(matchesMetadataPrefix("arclayer://agent/1", []), false);
});

test("SDK: collectJobWallets returns lowercase wallets from projected jobs", () => {
  const jobs = sdkProjectJobs([
    jobEvent("JobCreated", {
      client: "0xAAAA",
      provider: "0xBBBB",
      evaluator: "0xCCCC",
      expiredAt: 0n,
      hook: "0x0000000000000000000000000000000000000000",
      description: "d",
    }),
  ]);
  const wallets = collectJobWallets(jobs);
  assert.equal(wallets.has("0xaaaa"), true);
  assert.equal(wallets.has("0xbbbb"), true);
  assert.equal(wallets.has("0xcccc"), true);
});

test("SDK: buildOverviewAggregation computes correct totals", () => {
  const jobs = sdkProjectJobs([
    jobEvent("JobCreated", {
      client,
      provider,
      evaluator,
      expiredAt: 0n,
      hook: "0x0000000000000000000000000000000000000000",
      description: "job",
    }),
    jobEvent("BudgetSet", { amount: 1000n, logIndex: 1 }),
    jobEvent("JobFunded", { amount: 250n, logIndex: 2 }),
  ]);
  const agents = sdkProjectAgents([
    agentEvent({ agentId: 1n, controller: client, metadataURI: "arclayer://agent/1" }),
  ]);
  const overview = buildOverviewAggregation(jobs, agents, 4);
  assert.equal(overview.summary.totalBudgetAtomic, "1000");
  assert.equal(overview.summary.totalFundedAtomic, "250");
  assert.equal(overview.summary.budgetedUsdc, "0.001");
  assert.equal(overview.summary.fundedUsdc, "0.00025");
  assert.equal(overview.summary.jobs, 1);
  assert.equal(overview.summary.agents, 1);
  assert.equal(overview.summary.settledJobs, 0);
  assert.equal(overview.summary.fundedJobs, 1);
});

test("SDK: groupByJobId groups events correctly", () => {
  const grouped = groupByJobId([
    jobEvent("JobCreated", { jobId: 1n }),
    jobEvent("BudgetSet", { jobId: 1n, logIndex: 1 }),
    jobEvent("JobCreated", { jobId: 2n }),
  ]);
  assert.equal(Object.keys(grouped).length, 2);
  assert.equal(grouped["1"].length, 2);
  assert.equal(grouped["2"].length, 1);
});

test("SDK: groupByJobId drops events without jobId", () => {
  const grouped = groupByJobId([
    jobEvent("JobCreated", { jobId: 1n }),
    jobEvent("BudgetSet", { jobId: undefined }),
    jobEvent("JobFunded", { jobId: undefined }),
  ]);
  assert.equal(Object.keys(grouped).length, 1);
  assert.equal(grouped["1"].length, 1);
  assert.equal(grouped["unassigned"], undefined);
});

test("SDK: groupByAgentKey lowercases and groups", () => {
  const grouped = groupByAgentKey([
    { provider: "0xAAAA", agentId: 1n } as any,
    { provider: "0xAAAA", agentId: 1n } as any,
    { provider: "0xBBBB", agentId: 2n } as any,
  ]);
  assert.equal(Object.keys(grouped).length, 2);
  assert.equal(grouped["0xaaaa"].length, 2);
});

test("SDK: sourceForAgentEvent defaults to erc8004_identity_registry", () => {
  const event = agentEvent({ agentId: 1n, controller: client });
  assert.equal(sourceForAgentEvent(event), "erc8004_identity_registry");
});

test("SDK: sourceForAgentEvent reads source field", () => {
  const event = {
    ...agentEvent({ agentId: 1n }),
    source: "imported_arclayer_registry",
  } as IndexedAgentEvent;
  assert.equal(sourceForAgentEvent(event), "imported_arclayer_registry");
});

test("SDK: isImportedArcLayerAgent detects imported source", () => {
  const imported = {
    ...agentEvent({ agentId: 1n }),
    source: "imported_arclayer_registry",
  } as IndexedAgentEvent;
  const erc8004 = agentEvent({ agentId: 2n });
  assert.equal(isImportedArcLayerAgent(imported), true);
  assert.equal(isImportedArcLayerAgent(erc8004), false);
});

test("SDK: dedupeAgentEvents keeps last event per source:agentId", () => {
  const events = [
    {
      ...agentEvent({ agentId: 1n, blockNumber: 100n }),
      source: "erc8004_identity_registry",
    },
    {
      ...agentEvent({ agentId: 1n, blockNumber: 200n }),
      source: "erc8004_identity_registry",
    },
    { ...agentEvent({ agentId: 2n }), source: "imported_arclayer_registry" },
  ] as IndexedAgentEvent[];
  const deduped = dedupeAgentEvents(events);
  assert.equal(deduped.length, 2);
  const agent1 = deduped.find((e) => String(e.agentId) === "1");
  assert.equal(agent1?.blockNumber, 200n);
});

test("SDK: JOB_STATUS_CODE preserves canonical ERC-8183 codes", () => {
  assert.equal(JOB_STATUS_CODE.Open, 0);
  assert.equal(JOB_STATUS_CODE.Funded, 1);
  assert.equal(JOB_STATUS_CODE.Submitted, 2);
  assert.equal(JOB_STATUS_CODE.Completed, 3);
  assert.equal(JOB_STATUS_CODE.Rejected, 4);
  assert.equal(JOB_STATUS_CODE.Expired, 5);
});

test("SDK: JOB_STATUS_PRIORITY is alias for JOB_STATUS_CODE", () => {
  assert.deepEqual(JOB_STATUS_PRIORITY, JOB_STATUS_CODE);
});

test("SDK: projectJobFromEvents sorts by blockNumber+logIndex before selecting latest", () => {
  // Pass events in descending block order — projection must still pick the true latest BudgetSet
  const jobs = sdkProjectJobs([
    jobEvent("JobCreated", {
      jobId: 10n,
      client,
      provider,
      evaluator,
      expiredAt: 0n,
      hook: "0x0000000000000000000000000000000000000000",
      description: "sort-test",
      blockNumber: 300n,
      logIndex: 0,
    }),
    jobEvent("BudgetSet", { jobId: 10n, amount: 500n, blockNumber: 100n, logIndex: 1 }),
    jobEvent("BudgetSet", { jobId: 10n, amount: 1000n, blockNumber: 200n, logIndex: 2 }),
    // This one is last in the array but has the earliest block
    jobEvent("JobFunded", { jobId: 10n, amount: 100n, blockNumber: 150n, logIndex: 3 }),
  ]);
  assert.equal(jobs.length, 1);
  // Latest BudgetSet by blockNumber is at block 200 → amount 1000
  assert.equal(jobs[0].budget, "1000");
  // updatedAtBlock must be from the sorted-last event (block 300)
  assert.equal(jobs[0].updatedAtBlock, "300");
});

// ── Indexer runtime-filtered projection tests ──────────────────────────────

test("indexer: metadata prefix arclayer:// keeps agent through indexer filter", () => {
  const agents = projectAgentsFromEvents([
    agentEvent({
      agentId: 1n,
      controller: unrelatedWallet,
      metadataURI: "arclayer://agent/1",
    }),
  ]);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].metadataURI, "arclayer://agent/1");
});

test("indexer: metadata prefix https://arclayers.xyz keeps agent through indexer filter", () => {
  const agents = projectAgentsFromEvents([
    agentEvent({
      agentId: 2n,
      controller: unrelatedWallet,
      metadataURI: "https://arclayers.xyz/agent/2",
    }),
  ]);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].metadataURI, "https://arclayers.xyz/agent/2");
});

test("indexer: buildOverviewProjection returns correct aggregation", async () => {
  const events = [
    jobEvent("JobCreated", {
      client,
      provider,
      evaluator,
      expiredAt: 0n,
      hook: "0x0000000000000000000000000000000000000000",
      description: "job",
    }),
    jobEvent("BudgetSet", { amount: 1000n, logIndex: 1 }),
    jobEvent("JobFunded", { amount: 250n, logIndex: 2 }),
  ];
  const overview = await buildOverviewProjection(events, []);
  assert.equal(overview.summary.totalBudgetAtomic, "1000");
  assert.equal(overview.summary.totalFundedAtomic, "250");
  assert.equal(overview.summary.budgetedUsdc, "0.001");
  assert.equal(overview.summary.fundedUsdc, "0.00025");
});

test("indexer: buildAgentProjectionDebug reports source breakdown", () => {
  const events = [
    {
      ...agentEvent({
        agentId: 1n,
        controller: client,
        metadataURI: "arclayer://agent/1",
      }),
      source: "imported_arclayer_registry",
    },
    agentEvent({
      agentId: 2n,
      controller: client,
      metadataURI: "arclayer://agent/2",
    }),
  ] as IndexedAgentEvent[];
  const debug = buildAgentProjectionDebug(events);
  assert.equal(debug.storedAgentEventCount, 2);
  assert.equal(debug.rawImportedAgentEventCount, 1);
  assert.equal(debug.rawErc8004AgentEventCount, 1);
});

test("indexer: arcWalletFilterActive returns boolean", () => {
  const active = arcWalletFilterActive();
  assert.equal(typeof active, "boolean");
});
