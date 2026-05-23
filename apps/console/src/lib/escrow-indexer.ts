/**
 * escrow-indexer.ts — Human-to-Agent Vault / future custom module event stub.
 *
 * Pure Arc reference mode does not deploy Human-to-Agent Vault contracts by default; ERC-8183
 * AgenticCommerce events are indexed by the dedicated indexer service. This
 * stub keeps the import surface alive but always returns an empty event set.
 */

import type { Address } from 'viem';

export type EscrowEventName =
  | 'ProjectCreated'
  | 'ProjectFunded'
  | 'MilestoneSubmitted'
  | 'MilestoneReleased'

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
