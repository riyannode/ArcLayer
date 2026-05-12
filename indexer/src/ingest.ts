import { CONTRACTS, JOB_ESCROW_ABI, publicClient } from "@arclayer/sdk";
import type { IndexedJobEvent } from "@arclayer/sdk";
import { MAX_BLOCK_RANGE } from "./config";

const EVENT_NAMES = [
  "JobCreated",
  "JobFunded",
  "DeliverableSubmitted",
  "JobSettled",
] as const;

// Pre-extract the four event ABI items once. `getLogs({ events })` below
// sends a single eth_getLogs per chunk with topic0 = [JobCreated, JobFunded,
// DeliverableSubmitted, JobSettled] — replacing the previous 4-call fanout.
const JOB_EVENT_ABIS = JOB_ESCROW_ABI.filter(
  (item): item is typeof item & { type: "event"; name: typeof EVENT_NAMES[number] } =>
    item.type === "event" &&
    (EVENT_NAMES as readonly string[]).includes((item as { name?: string }).name ?? ""),
);

export type FetchJobEventsResult = {
  events: IndexedJobEvent[];
  latestBlock: bigint;
};

export async function fetchJobEvents(
  fromBlock: bigint = BigInt(0),
): Promise<FetchJobEventsResult> {
  const latestBlock = await publicClient.getBlockNumber();

  if (fromBlock > latestBlock) {
    return { events: [], latestBlock };
  }

  const collected: any[] = [];

  for (let start = fromBlock; start <= latestBlock; start += MAX_BLOCK_RANGE + BigInt(1)) {
    const end = start + MAX_BLOCK_RANGE > latestBlock ? latestBlock : start + MAX_BLOCK_RANGE;
    const chunk = await publicClient.getContractEvents({
      address: CONTRACTS.JOB_ESCROW,
      abi: JOB_ESCROW_ABI,
      fromBlock: start,
      toBlock: end,
    });
    collected.push(...chunk);
  }

  const events = collected
    .filter((event: any) => (EVENT_NAMES as readonly string[]).includes(event.eventName))
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

// Re-export for backwards compatibility with any external importers.
export { JOB_EVENT_ABIS };
