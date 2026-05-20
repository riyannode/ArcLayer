/**
 * arc-erc8183-ingest.ts — Secondary indexer for official Arc ERC-8183 AgenticCommerce.
 *
 * This module indexes events from Circle's reference ERC-8183 contract, but ONLY
 * for jobs where client OR provider is a known ArcLayer wallet/agent.
 *
 * Controlled by:
 *   INDEX_ARC_REFERENCE_ERC8183 (env, default: true)
 *   ARC_REFERENCE_WALLET_FILTER (env, comma-separated addresses)
 *   + auto-includes all agents registered in ArcLayer's AgentRegistry
 *
 * This is additive — it does NOT replace ArcLayer's own JobEscrow indexing.
 */

import { publicClient } from "@arclayer/sdk";
import {
  INDEX_ARC_REFERENCE_ERC8183,
  ARC_REFERENCE_WALLET_FILTER,
  ARC_ERC8183_ADDRESS,
  MAX_BLOCK_RANGE,
} from "./config";

// ── Minimal ABI for ERC-8183 events we care about ──────────────────────────────

const ERC8183_EVENTS_ABI = [
  {
    name: "JobCreated",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "evaluator", type: "address", indexed: false },
      { name: "expiredAt", type: "uint256", indexed: false },
      { name: "hook", type: "address", indexed: false },
    ],
  },
  {
    name: "BudgetSet",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    name: "JobFunded",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    name: "JobSubmitted",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "deliverable", type: "bytes32", indexed: false },
    ],
  },
  {
    name: "JobCompleted",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "reason", type: "bytes32", indexed: false },
    ],
  },
] as const;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ArcErc8183Event {
  eventName: "JobCreated" | "BudgetSet" | "JobFunded" | "JobSubmitted" | "JobCompleted";
  jobId: bigint;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
  /** Only present on JobCreated */
  client?: `0x${string}`;
  provider?: `0x${string}`;
  evaluator?: `0x${string}`;
  expiredAt?: bigint;
  hook?: `0x${string}`;
  /** Only present on BudgetSet/JobFunded */
  amount?: bigint;
  /** Only present on JobSubmitted */
  deliverable?: `0x${string}`;
  /** Only present on JobCompleted */
  reason?: `0x${string}`;
}

export interface FetchArcErc8183Result {
  events: ArcErc8183Event[];
  latestBlock: bigint;
}

// ── Wallet filter logic ────────────────────────────────────────────────────────

let _knownAgentAddresses: Set<string> = new Set();

/**
 * Call this after each ArcLayer AgentRegistry sync to update the auto-filter.
 * Pass all registered agent controller addresses (lowercase).
 */
export function updateKnownAgentAddresses(addresses: string[]) {
  _knownAgentAddresses = new Set(addresses.map((a) => a.toLowerCase()));
}

function isKnownWallet(address: string): boolean {
  const lower = address.toLowerCase();
  // Check static env filter
  if (ARC_REFERENCE_WALLET_FILTER.includes(lower)) return true;
  // Check dynamically registered ArcLayer agents
  if (_knownAgentAddresses.has(lower)) return true;
  return false;
}

function filterByKnownWallets(events: ArcErc8183Event[]): ArcErc8183Event[] {
  // For JobCreated, we can filter directly by client/provider.
  // For other events, we need to track which jobIds belong to known wallets.
  // Strategy: first pass collects known jobIds from JobCreated, second pass filters.

  const knownJobIds = new Set<string>();

  // Pass 1: identify jobs created by known wallets
  for (const ev of events) {
    if (ev.eventName === "JobCreated") {
      if (
        (ev.client && isKnownWallet(ev.client)) ||
        (ev.provider && isKnownWallet(ev.provider))
      ) {
        knownJobIds.add(ev.jobId.toString());
      }
    }
  }

  // Pass 2: keep events for known jobs only
  return events.filter((ev) => knownJobIds.has(ev.jobId.toString()));
}

// ── Fetch logic ────────────────────────────────────────────────────────────────

export async function fetchArcErc8183Events(
  fromBlock: bigint = BigInt(0),
): Promise<FetchArcErc8183Result> {
  if (!INDEX_ARC_REFERENCE_ERC8183) {
    const latestBlock = await publicClient.getBlockNumber();
    return { events: [], latestBlock };
  }

  const latestBlock = await publicClient.getBlockNumber();

  if (fromBlock > latestBlock) {
    return { events: [], latestBlock };
  }

  const collected: any[] = [];
  for (let start = fromBlock; start <= latestBlock; start += MAX_BLOCK_RANGE + BigInt(1)) {
    const end = start + MAX_BLOCK_RANGE > latestBlock ? latestBlock : start + MAX_BLOCK_RANGE;
    const chunk = await publicClient.getContractEvents({
      address: ARC_ERC8183_ADDRESS as `0x${string}`,
      abi: ERC8183_EVENTS_ABI as any,
      fromBlock: start,
      toBlock: end,
    });
    collected.push(...chunk);
  }

  const allEvents: ArcErc8183Event[] = collected
    .map((event: any) => {
      const args = (event.args ?? {}) as Record<string, unknown>;
      return {
        eventName: event.eventName as ArcErc8183Event["eventName"],
        jobId: args.jobId as bigint,
        blockNumber: event.blockNumber as bigint,
        transactionHash: event.transactionHash as `0x${string}`,
        logIndex: (event.logIndex ?? 0) as number,
        // JobCreated fields
        ...(args.client ? { client: args.client as `0x${string}` } : {}),
        ...(args.provider ? { provider: args.provider as `0x${string}` } : {}),
        ...(args.evaluator ? { evaluator: args.evaluator as `0x${string}` } : {}),
        ...(args.expiredAt ? { expiredAt: args.expiredAt as bigint } : {}),
        ...(args.hook ? { hook: args.hook as `0x${string}` } : {}),
        // BudgetSet/JobFunded
        ...(args.amount !== undefined ? { amount: args.amount as bigint } : {}),
        // JobSubmitted
        ...(args.deliverable ? { deliverable: args.deliverable as `0x${string}` } : {}),
        // JobCompleted
        ...(args.reason ? { reason: args.reason as `0x${string}` } : {}),
      };
    })
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber - b.blockNumber);
      return a.logIndex - b.logIndex;
    });

  // Apply wallet/agent filter — only keep jobs involving ArcLayer entities
  const filtered = filterByKnownWallets(allEvents);

  return { events: filtered, latestBlock };
}
