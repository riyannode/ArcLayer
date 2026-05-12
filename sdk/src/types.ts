import type { Address } from "viem";

export type ProjectTuple = readonly [
  bigint,
  Address,
  Address,
  bigint,
  bigint,
  bigint,
  bigint,
  string,
  string,
  number,
];

export type MilestoneTuple = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  string,
  string,
  number,
];

export type IndexedEscrowEvent = {
  eventName:
    | "ProjectCreated"
    | "ProjectFunded"
    | "MilestoneSubmitted"
    | "MilestoneReleased"
    | "WorkProofMinted";
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
