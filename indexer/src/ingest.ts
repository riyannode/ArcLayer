import { CONTRACTS, MILESTONE_ESCROW_ABI, publicClient } from "@arcwork/sdk";
import type { IndexedEscrowEvent } from "@arcwork/sdk";

const EVENT_NAMES = [
  "ProjectCreated",
  "ProjectFunded",
  "MilestoneSubmitted",
  "MilestoneReleased",
  "WorkProofMinted",
] as const;

export async function fetchEscrowEvents(fromBlock: bigint = BigInt(0)): Promise<IndexedEscrowEvent[]> {
  const eventGroups = await Promise.all(
    EVENT_NAMES.map((eventName) =>
      publicClient.getContractEvents({
        address: CONTRACTS.MILESTONE_ESCROW,
        abi: MILESTONE_ESCROW_ABI,
        eventName,
        fromBlock,
        toBlock: "latest",
      })
    )
  );

  return eventGroups
    .flat()
    .map((event) => ({
      eventName: event.eventName as IndexedEscrowEvent["eventName"],
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      ...(event.args as Record<string, unknown>),
    }))
    .sort((a, b) => Number(a.blockNumber - b.blockNumber));
}
