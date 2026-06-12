import test from "node:test";
import assert from "node:assert/strict";
import type { IndexedJobEvent, IndexedAgentEvent } from "@arclayer/sdk";
import {
  buildJobFilter,
  buildAgentFilter,
} from "./goldsky-scope-filters";

const client = "0x1111111111111111111111111111111111111111" as const;
const provider = "0x2222222222222222222222222222222222222222" as const;
const evaluator = "0x3333333333333333333333333333333333333333" as const;
const external = "0x9999999999999999999999999999999999999999" as const;
const tx = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

function mkJob(extra: Record<string, unknown>): IndexedJobEvent {
  return {
    eventName: "JobCreated",
    jobId: 1n,
    blockNumber: 100n,
    transactionHash: tx,
    logIndex: 0,
    ...extra,
  } as IndexedJobEvent;
}

function mkAgent(extra: Record<string, unknown>): IndexedAgentEvent {
  return {
    eventName: "AgentRegistered",
    blockNumber: 100n,
    transactionHash: tx,
    logIndex: 0,
    ...extra,
  } as IndexedAgentEvent;
}

// ── buildJobFilter tests ───────────────────────────────────────────────────

test("arclayer scope: empty wallet set rejects all jobs", () => {
  const filter = buildJobFilter(new Set());
  assert.equal(filter(mkJob({ client, provider, evaluator })), false);
  assert.equal(filter(mkJob({ client: external, provider: external, evaluator: external })), false);
});

test("arclayer scope: wallet set keeps matching jobs", () => {
  const allowed = new Set([client.toLowerCase(), provider.toLowerCase()]);
  const filter = buildJobFilter(allowed);

  // client match
  assert.equal(filter(mkJob({ client, provider: external, evaluator: external })), true);
  // provider match
  assert.equal(filter(mkJob({ client: external, provider, evaluator: external })), true);
  // evaluator match (not in set)
  assert.equal(filter(mkJob({ client: external, provider: external, evaluator })), false);
  // no match
  assert.equal(filter(mkJob({ client: external, provider: external, evaluator: external })), false);
});

test("arclayer scope: wallet set is case-insensitive", () => {
  const allowed = new Set([client.toLowerCase()]);
  const filter = buildJobFilter(allowed);
  assert.equal(filter(mkJob({ client: client.toUpperCase() as any, provider: external, evaluator: external })), true);
});

// ── buildAgentFilter tests ─────────────────────────────────────────────────

test("arclayer scope: empty allowlists rejects non-imported agents", () => {
  const filter = buildAgentFilter(new Set(), new Set(), new Set());
  assert.equal(filter(mkAgent({ agentId: 1n, controller: external, metadataURI: "https://example.com" })), false);
});

test("arclayer scope: imported agent always passes even with empty allowlists", () => {
  const filter = buildAgentFilter(new Set(), new Set(), new Set());
  const imported = { ...mkAgent({ agentId: 1n, controller: external }), source: "imported_arclayer_registry" } as IndexedAgentEvent;
  assert.equal(filter(imported), true);
});

test("arclayer scope: controller wallet match keeps agent", () => {
  const allowed = new Set([client.toLowerCase()]);
  const filter = buildAgentFilter(allowed, new Set(), new Set());
  assert.equal(filter(mkAgent({ agentId: 1n, controller: client, metadataURI: "https://example.com" })), true);
  assert.equal(filter(mkAgent({ agentId: 2n, controller: external, metadataURI: "https://example.com" })), false);
});

test("arclayer scope: job wallet cross-reference keeps agent", () => {
  const jobWallets = new Set([external.toLowerCase()]);
  const filter = buildAgentFilter(new Set(), new Set(), jobWallets);
  assert.equal(filter(mkAgent({ agentId: 1n, controller: external, metadataURI: "https://example.com" })), true);
  assert.equal(filter(mkAgent({ agentId: 2n, controller: client, metadataURI: "https://example.com" })), false);
});

test("arclayer scope: agentId match keeps agent", () => {
  const agentIds = new Set(["42"]);
  const filter = buildAgentFilter(new Set(), agentIds, new Set());
  assert.equal(filter(mkAgent({ agentId: 42n, controller: external, metadataURI: "https://example.com" })), true);
  assert.equal(filter(mkAgent({ agentId: 99n, controller: external, metadataURI: "https://example.com" })), false);
});

test("arclayer scope: metadata prefix arclayer:// keeps agent", () => {
  const filter = buildAgentFilter(new Set(), new Set(), new Set());
  assert.equal(filter(mkAgent({ agentId: 1n, controller: external, metadataURI: "arclayer://agent/1" })), true);
  assert.equal(filter(mkAgent({ agentId: 2n, controller: external, metadataURI: "https://arclayers.xyz/agent/2" })), true);
  assert.equal(filter(mkAgent({ agentId: 3n, controller: external, metadataURI: "https://example.com" })), false);
});

test("arclayer scope: multiple conditions are OR'd", () => {
  const allowed = new Set([client.toLowerCase()]);
  const agentIds = new Set(["99"]);
  const jobWallets = new Set([external.toLowerCase()]);
  const filter = buildAgentFilter(allowed, agentIds, jobWallets);

  // controller match
  assert.equal(filter(mkAgent({ agentId: 1n, controller: client, metadataURI: "https://example.com" })), true);
  // job wallet match
  assert.equal(filter(mkAgent({ agentId: 2n, controller: external, metadataURI: "https://example.com" })), true);
  // agentId match
  assert.equal(filter(mkAgent({ agentId: 99n, controller: "0xdead", metadataURI: "https://example.com" })), true);
  // metadata prefix match
  assert.equal(filter(mkAgent({ agentId: 100n, controller: "0xdead", metadataURI: "arclayer://agent/100" })), true);
  // no match
  assert.equal(filter(mkAgent({ agentId: 101n, controller: "0xdead", metadataURI: "https://example.com" })), false);
});
