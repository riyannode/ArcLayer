/**
 * escrow-indexer.ts — DEPRECATED legacy MilestoneEscrow event indexer.
 *
 * Pure Arc reference mode does not deploy a MilestoneEscrow contract; ERC-8183
 * AgenticCommerce events are indexed by the dedicated indexer service. This
 * stub keeps the import surface alive but always returns an empty event set.
 */

import type { Address } from 'viem';

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

export async function fetchEscrowEvents(_fromBlock: bigint = BigInt(0)): Promise<IndexedEscrowEvent[]> {
  return [];
}
