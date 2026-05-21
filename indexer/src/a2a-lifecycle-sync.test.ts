import test from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import {
  ERC8183JobStatus,
  lifecycleUpdatePayload,
  syncA2AJobsFromERC8183Events,
  syncA2AJobsFromERC8183Logs,
} from "./a2a-lifecycle-sync";

const provider = "0x1111111111111111111111111111111111111111" as Address;
const evaluator = "0x2222222222222222222222222222222222222222" as Address;
const tx = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

function makeSupabase(existingJobIds = new Set(["42"])) {
  const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  return {
    updates,
    client: {
      from(table: "a2a_jobs") {
        assert.equal(table, "a2a_jobs");
        return {
          update(payload: Record<string, unknown>) {
            return {
              async eq(column: "onchain_job_id", value: string) {
                assert.equal(column, "onchain_job_id");
                if (existingJobIds.has(value)) updates.push({ id: value, payload });
                return { error: null };
              },
            };
          },
        };
      },
    },
  };
}

test("BudgetSet updates budget_atomic and settlement_status = 1", () => {
  assert.deepEqual(lifecycleUpdatePayload({ eventName: "BudgetSet", jobId: 42n, amount: 123456n }), {
    budget_atomic: "123456",
    settlement_status: ERC8183JobStatus.BudgetSet,
  });
});

test("JobFunded updates fund_tx and settlement_status = 2", () => {
  assert.deepEqual(lifecycleUpdatePayload({ eventName: "JobFunded", jobId: 42n, transactionHash: tx }), {
    fund_tx: tx,
    settlement_status: ERC8183JobStatus.Funded,
  });
});

test("JobSubmitted updates tx, deliverable hash, status and submitted_at", () => {
  const payload = lifecycleUpdatePayload({
    eventName: "JobSubmitted",
    jobId: 42n,
    deliverable: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    transactionHash: tx,
    blockTimestamp: 1_700_000_000n,
  });

  assert.deepEqual(payload, {
    submit_tx: tx,
    deliverable_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    settlement_status: ERC8183JobStatus.Submitted,
    status: "submitted",
    submitted_at: "2023-11-14T22:13:20.000Z",
  });
});

test("JobCompleted updates complete_tx and settlement_status = 4 without internal completed status", () => {
  assert.deepEqual(lifecycleUpdatePayload({ eventName: "JobCompleted", jobId: 42n, transactionHash: tx }), {
    complete_tx: tx,
    settlement_status: ERC8183JobStatus.Completed,
  });
});

test("JobCreated marks onchain row and preserves bigint values as strings", () => {
  assert.deepEqual(lifecycleUpdatePayload({
    eventName: "JobCreated",
    jobId: 42n,
    provider,
    evaluator,
    budget: 1000000n,
  }), {
    is_onchain: true,
    onchain_job_id: "42",
    provider,
    evaluator,
    budget_atomic: "1000000",
    settlement_status: ERC8183JobStatus.Created,
  });
});

test("wrong contract log and unknown event are ignored", async () => {
  const store = makeSupabase();
  const result = await syncA2AJobsFromERC8183Logs([
    {
      address: "0x3333333333333333333333333333333333333333",
      data: "0x",
      topics: [],
      transactionHash: tx,
    },
    {
      address: "0x0747EEf0706327138c69792bF28Cd525089e4583",
      data: "0x",
      topics: [],
      transactionHash: tx,
    },
  ], store.client);

  assert.deepEqual(result, { updated: 0, skipped: 0 });
  assert.equal(store.updates.length, 0);
});

test("missing a2a_jobs row does not crash", async () => {
  const store = makeSupabase(new Set());
  const result = await syncA2AJobsFromERC8183Events([
    { eventName: "BudgetSet", jobId: 999n, amount: 1n },
  ], store.client);

  assert.deepEqual(result, { updated: 1, skipped: 0 });
  assert.equal(store.updates.length, 0);
});
