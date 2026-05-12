import { type Address } from 'viem';
import { CONTRACTS, MILESTONE_ESCROW_ABI } from './contracts';
import { ESCROW_CONFIGURED, publicClient } from './escrow';

export type EscrowEventName =
  | 'ProjectCreated'
  | 'ProjectFunded'
  | 'MilestoneSubmitted'
  | 'MilestoneReleased'
  | 'WorkProofMinted';

export type IndexedEscrowEvent = {
  eventName: EscrowEventName;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  projectId?: bigint;
  milestoneId?: bigint;
  freelancer?: Address;
  client?: Address;
  totalAmount?: bigint;
  payout?: bigint;
  fee?: bigint;
  deliverableURI?: string;
};

const EVENT_NAMES: EscrowEventName[] = [
  'ProjectCreated',
  'ProjectFunded',
  'MilestoneSubmitted',
  'MilestoneReleased',
  'WorkProofMinted',
];

export async function fetchEscrowEvents(fromBlock: bigint = BigInt(0)): Promise<IndexedEscrowEvent[]> {
  if (!ESCROW_CONFIGURED) return [];

  const eventGroups = await Promise.all(
    EVENT_NAMES.map((eventName) =>
      publicClient.getContractEvents({
        address: CONTRACTS.MILESTONE_ESCROW,
        abi: MILESTONE_ESCROW_ABI,
        eventName,
        fromBlock,
        toBlock: 'latest',
      })
    )
  );

  return eventGroups
    .flat()
    .map((event) => ({
      eventName: event.eventName as EscrowEventName,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
      ...(event.args as Record<string, unknown>),
    }))
    .sort((a, b) => Number(a.blockNumber - b.blockNumber));
}
