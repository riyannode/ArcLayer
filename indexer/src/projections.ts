import type { IndexedAgentEvent, IndexedJobEvent } from "@arclayer/sdk";
import { ARC_REFERENCE_WALLET_FILTER } from "./config";

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
  return ARC_REFERENCE_WALLET_FILTER.length > 0;
}

function matchesArcWallet(addr: unknown): boolean {
  if (!arcWalletFilterActive()) return true;
  if (typeof addr !== "string") return false;
  return ARC_REFERENCE_WALLET_FILTER.includes(addr.toLowerCase());
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
    const status = completed ? 4 : submitted ? 3 : totalFunded > BigInt(0) ? 2 : latestBudget ? 1 : 0;
    const statusLabel = ["Created", "Budgeted", "Funded", "Submitted", "Completed"][status];

    return {
      id,
      client: created?.client ?? "0x0000000000000000000000000000000000000000",
      provider: created?.provider ?? "0x0000000000000000000000000000000000000000",
      evaluator: created?.evaluator ?? "0x0000000000000000000000000000000000000000",
      hook: created?.hook ?? "0x0000000000000000000000000000000000000000",
      expiredAt: String(created?.expiredAt ?? 0),
      description: created?.description ?? "",
      budget: budget.toString(),
      fundedAmount: totalFunded.toString(),
      createdAtBlock: String(created?.blockNumber ?? jobEvents[0]?.blockNumber ?? 0),
      updatedAtBlock: String(jobEvents[jobEvents.length - 1]?.blockNumber ?? 0),
      deliverable: submitted?.deliverable ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
      completionReason: completed?.reason ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
      status,
      statusLabel,
      // Legacy aliases (deprecated) — kept for frontend migration
      worker: created?.provider ?? "0x0000000000000000000000000000000000000000",
      agentId: created?.provider ?? "0x0000000000000000000000000000000000000000",
      jobSpecHash: created?.description ?? "",
      deliverableURI: submitted?.deliverable ?? "",
      proofMetadataURI: "",
      approved: status === 4,
      createdAt: String(created?.blockNumber ?? jobEvents[0]?.blockNumber ?? 0),
      events: jobEvents,
    };
  });
}

export function projectAgentsFromEvents(
  events: IndexedAgentEvent[],
  /** Pass indexed job wallets so agents connected to ArcLayer jobs are retained */
  arcJobWallets?: Set<string>,
) {
  const byId = events.reduce<Record<string, IndexedAgentEvent>>((acc, event) => {
    acc[String(event.agentId)] = event;
    return acc;
  }, {});

  return Object.values(byId)
    .filter((event) => {
      if (!arcWalletFilterActive()) return true;
      const ctrl = (event.controller ?? "").toLowerCase();
      // Keep if controller matches allowlist
      if (matchesArcWallet(ctrl)) return true;
      // Keep if controller appears in any indexed ArcLayer job
      if (arcJobWallets && arcJobWallets.has(ctrl)) return true;
      return false;
    })
    .map((event) => ({
      agentId: String(event.agentId),
      tokenId: String(event.agentId),
      controller: event.controller,
      metadataURI: event.metadataURI ?? "",
      registeredAtBlock: String(event.blockNumber),
      transactionHash: event.transactionHash,
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
  const completedJobs = jobs.filter((job) => job.status === 4).length;
  const fundedJobs = jobs.filter((job) => BigInt(job.fundedAmount) > BigInt(0)).length;

  return {
    summary: {
      eventCount: jobEvents.length + agentEvents.length,
      jobs: jobs.length,
      agents: agents.length,
      proofs: proofs.length,
      totalBudget: totalBudget.toString(),
      totalFunded: totalFunded.toString(),
      settledJobs: completedJobs,
      fundedJobs,
    },
    jobs,
    agents,
    proofs,
  };
}
