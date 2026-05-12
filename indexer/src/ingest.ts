import { CONTRACTS, JOB_ESCROW_ABI, publicClient } from "@arclayer/sdk";
import type { IndexedJobEvent } from "@arclayer/sdk";

const EVENT_NAMES = [
  "JobCreated",
  "JobFunded",
  "DeliverableSubmitted",
  "JobSettled",
] as const;

const MAX_BLOCK_RANGE = BigInt(10_000);

export async function fetchJobEvents(fromBlock: bigint = BigInt(0)): Promise<IndexedJobEvent[]> {
  const latestBlock = await publicClient.getBlockNumber();
  const eventGroups: any[] = [];

  for (const eventName of EVENT_NAMES) {
    for (let start = fromBlock; start <= latestBlock; start += MAX_BLOCK_RANGE + BigInt(1)) {
      const end = start + MAX_BLOCK_RANGE > latestBlock ? latestBlock : start + MAX_BLOCK_RANGE;
      const chunk = await publicClient.getContractEvents({
        address: CONTRACTS.JOB_ESCROW,
        abi: JOB_ESCROW_ABI,
        eventName: eventName as any,
        fromBlock: start,
        toBlock: end,
      });
      eventGroups.push(chunk);
    }
  }

  return eventGroups
    .flat()
    .map((event: any) => ({
      eventName: event.eventName as IndexedJobEvent["eventName"],
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex ?? 0,
      ...(event.args as Record<string, unknown>),
    }))
    .sort((a, b) => Number(a.blockNumber - b.blockNumber));
}
