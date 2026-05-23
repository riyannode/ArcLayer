import test from "node:test";
import assert from "node:assert/strict";
import { calculateToBlock } from "./sync-range";
import { syncProjectionStore, readJobs, readAgents } from "./db";
import type { IndexedJobEvent, IndexedAgentEvent } from "@arclayer/sdk";

test("bounded toBlock calculation", () => {
  assert.equal(calculateToBlock(100n, 500n, 10n), 109n);
  assert.equal(calculateToBlock(100n, 104n, 10n), 104n);
});

test("START_BLOCK fallback does not override FROM_BLOCK", async () => {
  process.env.FROM_BLOCK = "123";
  process.env.START_BLOCK = "999";
  const config = await import(`./config.ts?ts=${Date.now()}`);
  assert.equal(config.DEFAULT_FROM_BLOCK, 123n);
});

test("disabled ERC8004 skips agent fetch config flag", async () => {
  process.env.INDEX_ARC_REFERENCE_ERC8004 = "false";
  const config = await import(`./config.ts?ts=${Date.now()}a`);
  assert.equal(config.INDEX_ARC_REFERENCE_ERC8004, false);
});

test("syncProjectionStore does not globally delete jobs/agents when processing one affected job", async () => {
  const mk = (jobId: bigint, logIndex: number): IndexedJobEvent => ({
    eventName: "JobCreated",
    jobId,
    provider: "0x2222222222222222222222222222222222222222",
    client: "0x1111111111111111111111111111111111111111",
    evaluator: "0x3333333333333333333333333333333333333333",
    expiredAt: 0n,
    description: "job",
    hook: "0x0000000000000000000000000000000000000000",
    blockNumber: BigInt(100 + logIndex),
    transactionHash: `0x${String(logIndex).padStart(64, "1")}` as `0x${string}`,
    logIndex,
  } as IndexedJobEvent);

  const agentEvent: IndexedAgentEvent = {
    eventName: "AgentRegistered",
    agentId: 1n,
    controller: "0x1111111111111111111111111111111111111111",
    metadataURI: "arclayer://agent/1",
    blockNumber: 100n,
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 0,
  } as IndexedAgentEvent;

  await syncProjectionStore([mk(1n, 1), mk(2n, 2)], [agentEvent]);
  const beforeJobs = readJobs().map((j) => j.id).sort();
  const beforeAgents = readAgents().map((a) => a.agentId);

  await syncProjectionStore([mk(1n, 3)], []);
  const afterJobs = readJobs().map((j) => j.id).sort();
  const afterAgents = readAgents().map((a) => a.agentId);

  assert.deepEqual(beforeJobs, afterJobs);
  assert.deepEqual(beforeAgents, afterAgents);
});
