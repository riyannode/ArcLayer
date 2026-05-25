import type { Address } from "viem";

// ── Official ERC-8004 / ERC-8183 events ─────────────────────────────────────

/** ERC-8004 IdentityRegistry — Transfer event signals registration (from=0x0). */
export type IndexedAgentEvent = {
  eventName: "AgentRegistered" | "Transfer";
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
  agentId: bigint;
  controller: Address;
  /** Optional metadata URI fetched via tokenURI(tokenId). */
  metadataURI?: string;
  /** @deprecated kept for legacy ABI parity. */
  skillHash?: `0x${string}`;
};

/** ERC-8183 AgenticCommerce — JobCreated/BudgetSet/JobFunded/JobSubmitted/JobCompleted. */
export type IndexedJobEvent = {
  eventName:
    | "JobCreated"
    | "BudgetSet"
    | "JobFunded"
    | "JobSubmitted"
    | "JobCompleted"
    // Legacy compat:
    | "DeliverableSubmitted"
    | "JobSettled";
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
  jobId?: bigint;
  agentId?: bigint;
  client?: Address;
  provider?: Address;
  evaluator?: Address;
  hook?: Address;
  expiredAt?: bigint;
  description?: string;
  amount?: bigint;
  deliverable?: `0x${string}`;
  reason?: `0x${string}`;
  // Legacy compat fields:
  worker?: Address;
  payout?: bigint;
  fee?: bigint;
  deliverableURI?: string;
};

// ── Legacy tuples (deprecated, kept as type aliases for migration) ──────────

/** @deprecated Human-to-Agent Vault/custom module tuple, not active in Arc/Circle mode. */
export type ProjectTuple = readonly [
  bigint, Address, Address, bigint, bigint, bigint, bigint, string, string, number,
];

/** @deprecated Human-to-Agent Vault/custom module tuple, not active in Arc/Circle mode. */
export type MilestoneTuple = readonly [
  bigint, bigint, bigint, bigint, bigint, string, string, number,
];

/** @deprecated Use ArcAgentRecord from client.ts. */
export type AgentRecordTuple = readonly [
  bigint, `0x${string}`, string, Address, bigint, bigint, boolean,
];

/** @deprecated Use ArcJobRecord from client.ts. */
export type JobTuple = readonly [
  bigint, bigint, Address, Address, Address, bigint, bigint, bigint,
  `0x${string}`, string, string, boolean, number,
];

/** @deprecated Old escrow event shape; replaced by IndexedJobEvent. */
export type IndexedEscrowEvent = {
  eventName:
    | "ProjectCreated"
    | "ProjectFunded"
    | "MilestoneSubmitted"
    | "MilestoneReleased"
;
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
