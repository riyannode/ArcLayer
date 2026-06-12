/**
 * Pure projection helpers for ERC-8183 job events and ERC-8004 agent events.
 *
 * These functions contain ZERO runtime coupling — no env reads, no Supabase,
 * no mutable state. The indexer layer injects filter callbacks at call site.
 *
 * @module sdk/src/indexer/projections
 */
import { formatUnits } from "viem";
import { ARC_ERC20_USDC_DECIMALS } from "../addresses";
import type { IndexedJobEvent, IndexedAgentEvent } from "../types";
import type {
  ProjectedJob,
  ProjectedAgent,
  OverviewProjection,
} from "./types";

// ── Constants ──────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/**
 * Terminal status priority: Completed(3) > Rejected(4) > Expired(5) > Submitted(2) > Funded(1) > Open(0).
 * Array index = numeric status value.
 */
const STATUS_LABELS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"] as const;

// ── Grouping helpers ───────────────────────────────────────────────────────

/** Group job events by jobId. Keys are decimal jobId strings; "unassigned" for events without jobId. */
export function groupByJobId(events: IndexedJobEvent[]): Record<string, IndexedJobEvent[]> {
  return events.reduce<Record<string, IndexedJobEvent[]>>((acc, event) => {
    const key = String(event.jobId ?? "unassigned");
    acc[key] ??= [];
    acc[key].push(event);
    return acc;
  }, {});
}

/** Group events by agent key (provider || agentId, lowercased). Keys are lowercase addresses/ids. */
export function groupByAgentKey(events: IndexedJobEvent[]): Record<string, IndexedJobEvent[]> {
  return events.reduce<Record<string, IndexedJobEvent[]>>((acc, event) => {
    const key = String((event as any).provider ?? (event as any).agentId ?? "unknown").toLowerCase();
    acc[key] ??= [];
    acc[key].push(event);
    return acc;
  }, {});
}

// ── Agent event source helpers ─────────────────────────────────────────────

/** Extract the source tag from an agent event. Defaults to "erc8004_identity_registry". */
export function sourceForAgentEvent(event: IndexedAgentEvent): string {
  return ((event as any).source as string | undefined) ?? "erc8004_identity_registry";
}

/** Deduplicate agent events by `${source}:${agentId}` — last event wins. */
export function dedupeAgentEvents(events: IndexedAgentEvent[]): IndexedAgentEvent[] {
  return Object.values(
    events.reduce<Record<string, IndexedAgentEvent>>((acc, event) => {
      acc[`${sourceForAgentEvent(event)}:${String(event.agentId)}`] = event;
      return acc;
    }, {}),
  );
}

/** Check if an agent event is from the imported ArcLayer registry. */
export function isImportedArcLayerAgent(event: IndexedAgentEvent): boolean {
  return sourceForAgentEvent(event) === "imported_arclayer_registry";
}

// ── Pure metadata matching ─────────────────────────────────────────────────

/** Check if a metadata URI starts with any of the given prefixes. Pure, no state. */
export function matchesMetadataPrefix(uri: string | undefined, prefixes: string[]): boolean {
  if (!uri || prefixes.length === 0) return false;
  return prefixes.some((prefix) => uri.startsWith(prefix));
}

// ── Job projection ─────────────────────────────────────────────────────────

/**
 * Project a single job from its event list. Returns null if the job should
 * be filtered out (i.e., the filter callback returns false).
 *
 * @param jobId - The jobId key (decimal string)
 * @param jobEvents - All events for this jobId
 * @param filter - Optional filter. Return true to KEEP the job. If omitted, all jobs pass.
 */
export function projectJobFromEvents(
  jobId: string,
  jobEvents: IndexedJobEvent[],
  filter?: (created: IndexedJobEvent | undefined) => boolean,
): ProjectedJob | null {
  const created = jobEvents.find((e) => e.eventName === "JobCreated");

  // Apply filter — if filter returns false, skip this job
  if (filter && !filter(created)) {
    return null;
  }

  const latestBudget = [...jobEvents].reverse().find((e) => e.eventName === "BudgetSet");
  const fundedEvents = jobEvents.filter((e) => e.eventName === "JobFunded");
  const submitted = [...jobEvents].reverse().find((e) => e.eventName === "JobSubmitted");
  const completed = [...jobEvents].reverse().find((e) => e.eventName === "JobCompleted");
  const rejected = [...jobEvents].reverse().find((e) => e.eventName === "JobRejected");
  const expired = [...jobEvents].reverse().find((e) => e.eventName === "JobExpired");
  const totalFunded = fundedEvents.reduce((sum, e) => sum + BigInt(e.amount ?? 0), BigInt(0));
  const budget = BigInt(latestBudget?.amount ?? 0);

  // Terminal priority: Completed(3) > Rejected(4) > Expired(5) > Submitted(2) > Funded(1) > Open(0)
  const status = completed ? 3 : rejected ? 4 : expired ? 5 : submitted ? 2 : totalFunded > BigInt(0) ? 1 : 0;
  const statusLabel = STATUS_LABELS[status];

  return {
    id: jobId,
    client: (created?.client ?? ZERO_ADDRESS) as any,
    provider: (created?.provider ?? ZERO_ADDRESS) as any,
    evaluator: (created?.evaluator ?? ZERO_ADDRESS) as any,
    hook: (created?.hook ?? ZERO_ADDRESS) as any,
    expiredAt: String(created?.expiredAt ?? 0),
    description: String(created?.description ?? ""),
    budget: budget.toString(),
    fundedAmount: totalFunded.toString(),
    createdAtBlock: String(created?.blockNumber ?? jobEvents[0]?.blockNumber ?? 0),
    updatedAtBlock: String(jobEvents[jobEvents.length - 1]?.blockNumber ?? 0),
    deliverable: (submitted?.deliverable ?? ZERO_BYTES32) as any,
    completionReason: ((completed as any)?.reason ?? (rejected as any)?.reason ?? ZERO_BYTES32) as any,
    rejector: (rejected as any)?.rejector ?? undefined,
    status,
    statusLabel,
    createdAt: String(created?.blockNumber ?? jobEvents[0]?.blockNumber ?? 0),
    events: jobEvents,
  };
}

/**
 * Project all jobs from events, applying an optional filter.
 *
 * @param events - All job events
 * @param filter - Optional filter callback. Receives the JobCreated event (or undefined).
 *                 Return true to KEEP the job. If omitted, all jobs are included.
 */
export function projectJobsFromEvents(
  events: IndexedJobEvent[],
  filter?: (created: IndexedJobEvent | undefined) => boolean,
): ProjectedJob[] {
  const byJob = groupByJobId(events);
  return Object.entries(byJob)
    .map(([id, jobEvents]) => projectJobFromEvents(id, jobEvents, filter))
    .filter((job): job is ProjectedJob => job !== null);
}

// ── Agent projection ───────────────────────────────────────────────────────

/**
 * Project agents from events, applying an optional filter.
 *
 * @param events - All agent events
 * @param filter - Optional filter callback. Receives the deduplicated agent event.
 *                 Return true to KEEP the agent. If omitted, all agents are included.
 */
export function projectAgentsFromEvents(
  events: IndexedAgentEvent[],
  filter?: (event: IndexedAgentEvent) => boolean,
): ProjectedAgent[] {
  return dedupeAgentEvents(events)
    .filter((event) => (filter ? filter(event) : true))
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

// ── Wallet collection ──────────────────────────────────────────────────────

/** Collect lowercase wallet addresses from projected jobs (client, provider, evaluator). */
export function collectJobWallets(jobs: ProjectedJob[]): Set<string> {
  const set = new Set<string>();
  for (const job of jobs) {
    if (job.client) set.add(job.client.toLowerCase());
    if (job.provider) set.add(job.provider.toLowerCase());
    if (job.evaluator) set.add(job.evaluator.toLowerCase());
  }
  return set;
}

// ── Overview aggregation ───────────────────────────────────────────────────

/**
 * Build overview projection from projected jobs and agents.
 * Pure aggregation — no filtering logic.
 */
export function buildOverviewAggregation(
  jobs: ProjectedJob[],
  agents: ProjectedAgent[],
  eventCount: number,
): OverviewProjection {
  const totalBudget = jobs.reduce((sum, job) => sum + BigInt(job.budget), BigInt(0));
  const totalFunded = jobs.reduce((sum, job) => sum + BigInt(job.fundedAmount), BigInt(0));
  const completedJobs = jobs.filter((job) => job.status === 3).length;
  const fundedJobs = jobs.filter((job) => BigInt(job.fundedAmount) > BigInt(0)).length;

  return {
    summary: {
      eventCount,
      jobs: jobs.length,
      agents: agents.length,
      proofs: 0,
      budgetedUsdc: formatUnits(totalBudget, ARC_ERC20_USDC_DECIMALS),
      fundedUsdc: formatUnits(totalFunded, ARC_ERC20_USDC_DECIMALS),
      totalBudgetAtomic: totalBudget.toString(),
      totalFundedAtomic: totalFunded.toString(),
      totalBudget: totalBudget.toString(),
      totalFunded: totalFunded.toString(),
      settledJobs: completedJobs,
      fundedJobs,
    },
    jobs,
    agents,
    proofs: [],
  };
}
