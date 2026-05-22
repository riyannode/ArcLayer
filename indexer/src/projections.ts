import { ARC_ERC20_USDC_DECIMALS, type IndexedAgentEvent, type IndexedJobEvent } from "@arclayer/sdk";
import { formatUnits } from "viem";
import { ARC_REFERENCE_METADATA_PREFIX_FILTER } from "./config";
import {
  matchesReferenceAgentId,
  matchesReferenceWallet,
  referenceAgentIdFilterActive,
  referenceWalletFilterActive,
} from "./reference-filters";

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
  return matchesReferenceWallet(addr, "arclayer");
}

export function buildJobProjection(events: IndexedJobEvent[]) {
  return events.reduce<Record<string, IndexedJobEvent[]>>((acc, event) => {
    const key = String(event.jobId ?? "unassigned");
    acc[key] ??= [];
    acc[key].push(event);
    return acc;
  }, {});
}

export function buildAgentEventProjection(events: IndexedJobEvent[]) {
  return events.reduce<Record<string, IndexedJobEvent[]>>((acc, event) => {
    const key = String((event as any).provider ?? (event as any).agentId ?? "unknown").toLowerCase();
    acc[key] ??= [];
    acc[key].push(event);
    return acc;
  }, {});
}

export function projectJobsFromEvents(events: IndexedJobEvent[]) {
  const byJob = buildJobProjection(events);

  return Object.entries(byJob).flatMap(([id, jobEvents]) => {
    const created = jobEvents.find((event) => event.eventName === "JobCreated") as any;

    // ArcLayer wallet filter: skip jobs not owned by ArcLayer wallets
    if (
      !matchesArcWallet(created?.client) &&
      !matchesArcWallet(created?.provider) &&
      !matchesArcWallet(created?.evaluator)
    ) {
      return [];
    }

    const latestBudget = [...jobEvents].reverse().find((event) => event.eventName === "BudgetSet") as any;
    const fundedEvents = jobEvents.filter((event) => event.eventName === "JobFunded") as any[];
    const submitted = [...jobEvents].reverse().find((event) => event.eventName === "JobSubmitted") as any;
    const completed = [...jobEvents].reverse().find((event) => event.eventName === "JobCompleted") as any;
    const totalFunded = fundedEvents.reduce((sum, event) => sum + BigInt(event.amount ?? 0), BigInt(0));
    const budget = BigInt(latestBudget?.amount ?? 0);
    const status = completed ? 3 : submitted ? 2 : totalFunded > BigInt(0) ? 1 : 0;
    const statusLabel = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"][status];

    return {
      id,
      client: created?.client ?? "0x0000000000000000000000000000000000000000",
      provider: created?.provider ?? "0x0000000000000000000000000000000000000000",
      evaluator: created?.evaluator ?? "0x0000000000000000000000000000000000000000",
      hook: created?.hook ?? "0x0000000000000000000000000000000000000000",
      expiredAt: String(created?.expiredAt ?? 0),
      description: "",
      budget: budget.toString(),
      fundedAmount: totalFunded.toString(),
      createdAtBlock: String(created?.blockNumber ?? jobEvents[0]?.blockNumber ?? 0),
      updatedAtBlock: String(jobEvents[jobEvents.length - 1]?.blockNumber ?? 0),
      deliverable: submitted?.deliverable ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
      completionReason: completed?.reason ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
      status,
      statusLabel,
      createdAt: String(created?.blockNumber ?? jobEvents[0]?.blockNumber ?? 0),
      events: jobEvents,
    };
  });
}

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

export function sourceForAgentEvent(event: IndexedAgentEvent) {
  return ((event as any).source as string | undefined) ?? "erc8004_identity_registry";
}

function isImportedArcLayerAgent(event: IndexedAgentEvent) {
  return sourceForAgentEvent(event) === "imported_arclayer_registry";
}

function dedupeAgentEvents(events: IndexedAgentEvent[]) {
  return Object.values(events.reduce<Record<string, IndexedAgentEvent>>((acc, event) => {
    acc[`${sourceForAgentEvent(event)}:${String(event.agentId)}`] = event;
    return acc;
  }, {}));
}

function getAgentFilterReason(event: IndexedAgentEvent, arcJobWallets?: Set<string>): string | null {
  if (isImportedArcLayerAgent(event)) return "imported_arclayer_registry";
  if (!arcWalletFilterActive()) return "wallet_filter_inactive";

  const source = sourceForAgentEvent(event);
  const ctrl = (event.controller ?? "").toLowerCase();
  const uri = event.metadataURI ?? "";
  const rawAgentId = String(event.agentId);
  const sourceAgentId = `${source}:${rawAgentId}`;
  const agentIdMatch = referenceAgentIdFilterActive()
    ? matchesReferenceAgentId(rawAgentId, "arclayer") || matchesReferenceAgentId(sourceAgentId, "arclayer")
    : false;
  const metadataMatch = ARC_REFERENCE_METADATA_PREFIX_FILTER.length > 0 && uri
    ? ARC_REFERENCE_METADATA_PREFIX_FILTER.some((prefix) => uri.startsWith(prefix))
    : false;

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
  const deduped = dedupeAgentEvents(events);
  const agentEventSourceBreakdown = events.reduce<Record<string, number>>((acc, event) => {
    const source = sourceForAgentEvent(event);
    acc[source] = (acc[source] ?? 0) + 1;
    return acc;
  }, {});
  const projected = deduped.filter((event) => getAgentFilterReason(event, arcJobWallets) !== null);
  const filtered = deduped.filter(
    (event) => sourceForAgentEvent(event) === "erc8004_identity_registry" && getAgentFilterReason(event, arcJobWallets) === null,
  );

  return {
    storedAgentEventCount: events.length,
    agentEventSourceBreakdown,
    rawImportedAgentEventCount: events.filter((event) => sourceForAgentEvent(event) === "imported_arclayer_registry").length,
    rawErc8004AgentEventCount: events.filter((event) => sourceForAgentEvent(event) === "erc8004_identity_registry").length,
    projectedImportedAgentCountBeforeInsert: projected.filter((event) => sourceForAgentEvent(event) === "imported_arclayer_registry").length,
    projectedErc8004AgentCountBeforeInsert: projected.filter((event) => sourceForAgentEvent(event) === "erc8004_identity_registry").length,
    filteredOutErc8004AgentCount: filtered.length,
    sampleFilteredErc8004Agents: filtered.slice(0, 5).map((event) => ({
      agentId: String(event.agentId),
      controller: event.controller ?? "",
      metadataURI: event.metadataURI ?? "",
      reason: "no controller wallet, job wallet, agent id, or metadata prefix match",
    })),
  };
}

export function projectAgentsFromEvents(
  events: IndexedAgentEvent[],
  /** Pass indexed job wallets so agents connected to ArcLayer jobs are retained */
  arcJobWallets?: Set<string>,
) {
  return dedupeAgentEvents(events)
    .filter((event) => getAgentFilterReason(event, arcJobWallets) !== null)
    .map((event) => ({
      agentId: String(event.agentId),
      tokenId: String(event.agentId),
      controller: event.controller,
      metadataURI: event.metadataURI ?? "",
      registeredAtBlock: String(event.blockNumber),
      transactionHash: event.transactionHash,
      skillHash: event.skillHash,
      source: sourceForAgentEvent(event),
      chainId: (event as any).chainId ?? 5042002,
      registryAddress: (event as any).registryAddress,
      contractAddress: (event as any).contractAddress,
    }));
}

export async function buildJobsProjection(events: IndexedJobEvent[] = []) {
  return projectJobsFromEvents(events);
}

export async function buildJobDetailProjection(jobId: bigint, events: IndexedJobEvent[] = []) {
  const job = projectJobsFromEvents(events).find((entry) => entry.id === jobId.toString());
  if (!job) return null;
  return { job, proof: null };
}

/** Collect lowercase wallet addresses from retained ArcLayer jobs. */
function collectJobWallets(jobs: ReturnType<typeof projectJobsFromEvents>): Set<string> {
  const set = new Set<string>();
  for (const job of jobs) {
    if (job.client) set.add(job.client.toLowerCase());
    if (job.provider) set.add(job.provider.toLowerCase());
    if (job.evaluator) set.add(job.evaluator.toLowerCase());
  }
  return set;
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
  const proofs: unknown[] = [];

  const totalBudget = jobs.reduce((sum, job) => sum + BigInt(job.budget), BigInt(0));
  const totalFunded = jobs.reduce((sum, job) => sum + BigInt(job.fundedAmount), BigInt(0));
  const completedJobs = jobs.filter((job) => job.status === 3).length;
  const fundedJobs = jobs.filter((job) => BigInt(job.fundedAmount) > BigInt(0)).length;
  const totalBudgetAtomic = totalBudget.toString();
  const totalFundedAtomic = totalFunded.toString();

  return {
    summary: {
      eventCount: jobEvents.length + agentEvents.length,
      jobs: jobs.length,
      agents: agents.length,
      proofs: proofs.length,
      budgetedUsdc: formatUnits(totalBudget, ARC_ERC20_USDC_DECIMALS),
      fundedUsdc: formatUnits(totalFunded, ARC_ERC20_USDC_DECIMALS),
      totalBudgetAtomic,
      totalFundedAtomic,
      totalBudget: totalBudgetAtomic,
      totalFunded: totalFundedAtomic,
      settledJobs: completedJobs,
      fundedJobs,
    },
    jobs,
    agents,
    proofs,
  };
}
