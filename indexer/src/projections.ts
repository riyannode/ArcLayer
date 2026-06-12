/**
 * Indexer projection layer — wires runtime filter config into pure SDK projection helpers.
 *
 * The SDK provides pure projection functions. This module:
 * 1. Reads runtime config (env, Supabase-refreshed wallets) via reference-filters
 * 2. Builds filter callbacks
 * 3. Passes them into SDK projection functions
 *
 * @module indexer/src/projections
 */
import { formatUnits } from "viem";
import {
  ARC_ERC20_USDC_DECIMALS,
  type IndexedAgentEvent,
  type IndexedJobEvent,
  // Pure projection helpers from SDK:
  projectJobsFromEvents as sdkProjectJobs,
  projectAgentsFromEvents as sdkProjectAgents,
  buildOverviewAggregation,
  collectJobWallets,
  sourceForAgentEvent,
  isImportedArcLayerAgent,
  matchesMetadataPrefix,
  type ProjectedJob,
  type ProjectedAgent,
} from "@arclayer/sdk";
import { ARC_REFERENCE_METADATA_PREFIX_FILTER, INDEXER_SCOPE } from "./config";
import {
  matchesReferenceAgentId,
  matchesReferenceWallet,
  referenceAgentIdFilterActive,
  referenceWalletFilterActive,
} from "./reference-filters";

// ── Re-exports for backward compat ─────────────────────────────────────────

export type { ProjectedJob, ProjectedAgent } from "@arclayer/sdk";

/**
 * ArcLayer event filtering.
 *
 * Official ERC-8004 / ERC-8183 contracts are shared infrastructure used by
 * every Arc project. The indexer reads global events but must NOT label them
 * all as ArcLayer activity. Filtering rules:
 *
 * - If ARC_REFERENCE_WALLET_FILTER is set, only jobs whose client OR provider
 *   OR evaluator matches the allowlist are surfaced as ArcLayer-owned.
 * - Agents are surfaced if controller matches the allowlist OR if the agent
 *   appears in any retained ArcLayer-owned job (provider/evaluator/client).
 * - If the filter is empty, the indexer is in "global reference mode" — see
 *   /health for the warning. In production this should not be empty.
 */
export function arcWalletFilterActive(): boolean {
  return referenceWalletFilterActive();
}

function matchesArcWallet(addr: unknown): boolean {
  return matchesReferenceWallet(addr, INDEXER_SCOPE);
}

// ── Job projection (runtime-filtered) ──────────────────────────────────────

/** Job filter callback — checks client/provider/evaluator against ArcLayer wallet allowlist. */
function jobFilter(created: IndexedJobEvent | undefined): boolean {
  return (
    matchesArcWallet((created as any)?.client) ||
    matchesArcWallet((created as any)?.provider) ||
    matchesArcWallet((created as any)?.evaluator)
  );
}

/**
 * Build raw jobId→events grouping. Re-exported for direct use by server endpoints.
 */
export function buildJobProjection(events: IndexedJobEvent[]) {
  return events.reduce<Record<string, IndexedJobEvent[]>>((acc, event) => {
    const key = String(event.jobId ?? "unassigned");
    acc[key] ??= [];
    acc[key].push(event);
    return acc;
  }, {});
}

/**
 * Build raw agentKey→events grouping. Re-exported for direct use by server endpoints.
 */
export function buildAgentEventProjection(events: IndexedJobEvent[]) {
  return events.reduce<Record<string, IndexedJobEvent[]>>((acc, event) => {
    const key = String((event as any).provider ?? (event as any).agentId ?? "unknown").toLowerCase();
    acc[key] ??= [];
    acc[key].push(event);
    return acc;
  }, {});
}

/**
 * Project jobs from events — applies ArcLayer wallet filter.
 * Uses SDK pure projection with runtime filter callback.
 */
export function projectJobsFromEvents(events: IndexedJobEvent[]): ProjectedJob[] {
  return sdkProjectJobs(events, jobFilter);
}

// ── Agent projection (runtime-filtered) ────────────────────────────────────

export type AgentProjectionDebug = {
  storedAgentEventCount: number;
  agentEventSourceBreakdown: Record<string, number>;
  rawImportedAgentEventCount: number;
  rawErc8004AgentEventCount: number;
  projectedImportedAgentCountBeforeInsert: number;
  projectedErc8004AgentCountBeforeInsert: number;
  filteredOutErc8004AgentCount: number;
  sampleFilteredErc8004Agents: Array<{ agentId: string; controller: string; metadataURI: string; reason: string }>;
};

function getAgentFilterReason(event: IndexedAgentEvent, arcJobWallets?: Set<string>): string | null {
  if (isImportedArcLayerAgent(event)) return "imported_arclayer_registry";
  if (!arcWalletFilterActive()) return "wallet_filter_inactive";

  const source = sourceForAgentEvent(event);
  const ctrl = (event.controller ?? "").toLowerCase();
  const uri = event.metadataURI ?? "";
  const rawAgentId = String(event.agentId);
  const sourceAgentId = `${source}:${rawAgentId}`;
  const agentIdMatch = referenceAgentIdFilterActive()
    ? matchesReferenceAgentId(rawAgentId, INDEXER_SCOPE) || matchesReferenceAgentId(sourceAgentId, INDEXER_SCOPE)
    : false;
  const metadataMatch = matchesMetadataPrefix(uri, ARC_REFERENCE_METADATA_PREFIX_FILTER);

  if (matchesArcWallet(ctrl)) return "controller_wallet_match";
  if (arcJobWallets?.has(ctrl)) return "arc_job_wallet_match";
  if (agentIdMatch) return "agent_id_match";
  if (metadataMatch) return "metadata_prefix_match";
  return null;
}

export function buildAgentProjectionDebug(
  events: IndexedAgentEvent[],
  arcJobWallets?: Set<string>,
): AgentProjectionDebug {
  const agentEventSourceBreakdown = events.reduce<Record<string, number>>((acc, event) => {
    const source = sourceForAgentEvent(event);
    acc[source] = (acc[source] ?? 0) + 1;
    return acc;
  }, {});
  const projected = sdkProjectAgents(events, (event) => getAgentFilterReason(event, arcJobWallets) !== null);
  const filtered = sdkProjectAgents(events, (event) =>
    sourceForAgentEvent(event) === "erc8004_identity_registry" && getAgentFilterReason(event, arcJobWallets) === null,
  );

  return {
    storedAgentEventCount: events.length,
    agentEventSourceBreakdown,
    rawImportedAgentEventCount: events.filter((event) => sourceForAgentEvent(event) === "imported_arclayer_registry").length,
    rawErc8004AgentEventCount: events.filter((event) => sourceForAgentEvent(event) === "erc8004_identity_registry").length,
    projectedImportedAgentCountBeforeInsert: projected.filter((a) => a.source === "imported_arclayer_registry").length,
    projectedErc8004AgentCountBeforeInsert: projected.filter((a) => a.source === "erc8004_identity_registry").length,
    filteredOutErc8004AgentCount: filtered.length,
    sampleFilteredErc8004Agents: filtered.slice(0, 5).map((a) => ({
      agentId: a.agentId,
      controller: a.controller,
      metadataURI: a.metadataURI,
      reason: "no controller wallet, job wallet, agent id, or metadata prefix match",
    })),
  };
}

/**
 * Project agents from events — applies ArcLayer filter (wallet, agentId, metadata prefix, job wallets).
 * Uses SDK pure projection with runtime filter callback.
 */
export function projectAgentsFromEvents(
  events: IndexedAgentEvent[],
  arcJobWallets?: Set<string>,
): ProjectedAgent[] {
  return sdkProjectAgents(events, (event) => getAgentFilterReason(event, arcJobWallets) !== null);
}

// ── Compound projections (async, used by server endpoints) ─────────────────

export async function buildJobsProjection(events: IndexedJobEvent[] = []) {
  return projectJobsFromEvents(events);
}

export async function buildJobDetailProjection(jobId: bigint, events: IndexedJobEvent[] = []) {
  const job = projectJobsFromEvents(events).find((entry) => entry.id === jobId.toString());
  if (!job) return null;
  return { job, proof: null };
}

export async function buildAgentsProjection(
  agentEvents: IndexedAgentEvent[] = [],
  jobEvents: IndexedJobEvent[] = [],
) {
  const jobWallets = collectJobWallets(projectJobsFromEvents(jobEvents));
  return projectAgentsFromEvents(agentEvents, jobWallets);
}

export async function buildAgentDetailProjection(
  agentId: bigint,
  agentEvents: IndexedAgentEvent[] = [],
  jobEvents: IndexedJobEvent[] = [],
) {
  const jobs = projectJobsFromEvents(jobEvents);
  const jobWallets = collectJobWallets(jobs);
  const agent = projectAgentsFromEvents(agentEvents, jobWallets).find(
    (entry) => entry.agentId === agentId.toString(),
  );
  if (!agent) return null;

  const agentJobs = jobs.filter(
    (job) =>
      job.provider?.toLowerCase() === agent.controller.toLowerCase() ||
      job.client?.toLowerCase() === agent.controller.toLowerCase(),
  );

  return {
    agent,
    jobs: agentJobs,
    proofs: [],
  };
}

export async function buildProofsProjection() {
  // ERC-8183 reference flow does not mint ArcLayer custom WorkProof NFTs.
  return [];
}

export async function buildOverviewProjection(
  jobEvents: IndexedJobEvent[],
  agentEvents: IndexedAgentEvent[] = [],
) {
  const jobs = projectJobsFromEvents(jobEvents);
  const agents = projectAgentsFromEvents(agentEvents, collectJobWallets(jobs));
  return buildOverviewAggregation(jobs, agents, jobEvents.length + agentEvents.length);
}
