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

export type AgentRecordTuple = readonly [
  bigint,
  `0x${string}`,
  string,
  Address,
  bigint,
  bigint,
  boolean,
];

export type JobTuple = readonly [
  bigint,
  bigint,
  Address,
  Address,
  Address,
  bigint,
  bigint,
  bigint,
  `0x${string}`,
  string,
  string,
  boolean,
  number,
];

export type WorkProofTuple = readonly [
  bigint,
  bigint,
  Address,
  bigint,
  bigint,
  string,
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

export type IndexedJobEvent = {
  eventName: "JobCreated" | "JobFunded" | "DeliverableSubmitted" | "JobSettled";
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
  jobId?: bigint;
  agentId?: bigint;
  client?: Address;
  worker?: Address;
  evaluator?: Address;
  payout?: bigint;
  fee?: bigint;
  amount?: bigint;
  deliverableURI?: string;
};
