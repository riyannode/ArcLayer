import test from "node:test";
import assert from "node:assert/strict";
import type { IndexedJobEvent } from "@arclayer/sdk";
import { buildOverviewProjection, projectJobsFromEvents } from "./projections";

const tx = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const client = "0x1111111111111111111111111111111111111111" as const;
const provider = "0x2222222222222222222222222222222222222222" as const;
const evaluator = "0x3333333333333333333333333333333333333333" as const;

function event(eventName: IndexedJobEvent["eventName"], extra: Record<string, unknown>): IndexedJobEvent {
  return {
    eventName,
    jobId: 42n,
    blockNumber: 100n,
    transactionHash: tx,
    logIndex: 0,
    ...extra,
  } as IndexedJobEvent;
}

test("projectJobsFromEvents sums JobFunded.amount and marks funded status", () => {
  const jobs = projectJobsFromEvents([
    event("JobCreated", {
      client,
      provider,
      evaluator,
      expiredAt: 0n,
      hook: "0x0000000000000000000000000000000000000000",
      description: "job",
    }),
    event("BudgetSet", { amount: 1000n, logIndex: 1 }),
    event("JobFunded", { amount: 400n, logIndex: 2 }),
    event("JobFunded", { amount: 600n, logIndex: 3 }),
  ]);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].budget, "1000");
  assert.equal(jobs[0].fundedAmount, "1000");
  assert.equal(jobs[0].status, 1);
  assert.equal(jobs[0].statusLabel, "Funded");
});

test("projectJobsFromEvents preserves ERC-8183 status label order", () => {
  const jobs = projectJobsFromEvents([
    event("JobCreated", { client, provider, evaluator, expiredAt: 0n, hook: "0x0000000000000000000000000000000000000000", description: "job" }),
    event("BudgetSet", { amount: 1000n, logIndex: 1 }),
    event("JobFunded", { amount: 1000n, logIndex: 2 }),
    event("JobSubmitted", { deliverable: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", logIndex: 3 }),
    event("JobCompleted", { reason: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", logIndex: 4 }),
  ]);

  assert.equal(jobs[0].status, 3);
  assert.equal(jobs[0].statusLabel, "Completed");
});

test("buildOverviewProjection exposes atomic totals and formatted USDC totals", async () => {
  const overview = await buildOverviewProjection([
    event("JobCreated", {
      client,
      provider,
      evaluator,
      expiredAt: 0n,
      hook: "0x0000000000000000000000000000000000000000",
      description: "job",
    }),
    event("BudgetSet", { amount: 1000n, logIndex: 1 }),
    event("JobFunded", { amount: 250n, logIndex: 2 }),
  ]);

  assert.equal(overview.summary.totalBudgetAtomic, "1000");
  assert.equal(overview.summary.totalFundedAtomic, "250");
  assert.equal(overview.summary.totalBudget, "1000");
  assert.equal(overview.summary.totalFunded, "250");
  assert.equal(overview.summary.budgetedUsdc, "0.001");
  assert.equal(overview.summary.fundedUsdc, "0.00025");
});
