import { AGENT_REGISTRY_ABI, CONTRACTS, JOB_ESCROW_ABI, publicClient } from "@arclayer/sdk";
import type { IndexedAgentEvent, IndexedJobEvent } from "@arclayer/sdk";
import { MAX_BLOCK_RANGE } from "./config";

const JOB_EVENT_NAMES = [
  "JobCreated",
  "JobFunded",
  "DeliverableSubmitted",
  "JobSettled",
] as const;

const AGENT_EVENT_NAMES = ["AgentRegistered"] as const;

// Pre-extract the four event ABI items once. `getLogs({ events })` below
// sends a single eth_getLogs per chunk with topic0 = [JobCreated, JobFunded,
// DeliverableSubmitted, JobSettled] — replacing the previous 4-call fanout.
const JOB_EVENT_ABIS = JOB_ESCROW_ABI.filter(
  (item): item is typeof item & { type: "event"; name: typeof JOB_EVENT_NAMES[number] } =>
    item.type === "event" &&
    (JOB_EVENT_NAMES as readonly string[]).includes((item as { name?: string }).name ?? ""),
);

const AGENT_EVENT_ABIS = AGENT_REGISTRY_ABI.filter(
  (item): item is typeof item & { type: "event"; name: typeof AGENT_EVENT_NAMES[number] } =>
    item.type === "event" &&
    (AGENT_EVENT_NAMES as readonly string[]).includes((item as { name?: string }).name ?? ""),
);

export type FetchJobEventsResult = {
  events: IndexedJobEvent[];
  latestBlock: bigint;
};

export type FetchAgentEventsResult = {
  events: IndexedAgentEvent[];
  latestBlock: bigint;
};

async function fetchEventsChunked(
  address: `0x${string}`,
  abi: readonly unknown[],
  fromBlock: bigint,
  latestBlock: bigint,
): Promise<any[]> {
  const collected: any[] = [];
  for (let start = fromBlock; start <= latestBlock; start += MAX_BLOCK_RANGE + BigInt(1)) {
    const end = start + MAX_BLOCK_RANGE > latestBlock ? latestBlock : start + MAX_BLOCK_RANGE;
    const chunk = await publicClient.getContractEvents({
      address,
      abi: abi as any,
      fromBlock: start,
      toBlock: end,
    });
    collected.push(...chunk);
  }
  return collected;
}

export async function fetchJobEvents(
  fromBlock: bigint = BigInt(0),
): Promise<FetchJobEventsResult> {
  const latestBlock = await publicClient.getBlockNumber();

  if (fromBlock > latestBlock) {
    return { events: [], latestBlock };
  }

  const collected = await fetchEventsChunked(
    CONTRACTS.JOB_ESCROW,
    JOB_ESCROW_ABI,
    fromBlock,
    latestBlock,
  );

  const events = collected
    .filter((event: any) => (JOB_EVENT_NAMES as readonly string[]).includes(event.eventName))
    .map((event: any) => ({
      eventName: event.eventName as IndexedJobEvent["eventName"],
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex ?? 0,
      ...(event.args as Record<string, unknown>),
    }))
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return Number(a.blockNumber - b.blockNumber);
      }
      return a.logIndex - b.logIndex;
    });

  return { events, latestBlock };
}

export async function fetchAgentEvents(
  fromBlock: bigint = BigInt(0),
): Promise<FetchAgentEventsResult> {
  const latestBlock = await publicClient.getBlockNumber();

  if (fromBlock > latestBlock) {
    return { events: [], latestBlock };
  }

  const collected = await fetchEventsChunked(
    CONTRACTS.AGENT_REGISTRY,
    AGENT_REGISTRY_ABI,
    fromBlock,
    latestBlock,
  );

  const events = collected
    .filter((event: any) => (AGENT_EVENT_NAMES as readonly string[]).includes(event.eventName))
    .map((event: any) => {
      const args = (event.args ?? {}) as Record<string, unknown>;
      return {
        eventName: "AgentRegistered" as const,
        blockNumber: event.blockNumber as bigint,
        transactionHash: event.transactionHash as `0x${string}`,
        logIndex: (event.logIndex ?? 0) as number,
        agentId: args.agentId as bigint,
        controller: args.controller as `0x${string}`,
        skillHash: args.skillHash as `0x${string}`,
        metadataURI: (args.metadataURI ?? "") as string,
      } satisfies IndexedAgentEvent;
    })
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return Number(a.blockNumber - b.blockNumber);
      }
      return a.logIndex - b.logIndex;
    });

  return { events, latestBlock };
}

// Re-export for backwards compatibility with any external importers.
export { JOB_EVENT_ABIS, AGENT_EVENT_ABIS };
