import type { Address } from "viem";
import type { IndexedJobEvent, IndexedAgentEvent } from "../types";

// ── Projected job ──────────────────────────────────────────────────────────

export type JobStatus = "Open" | "Funded" | "Submitted" | "Completed" | "Rejected" | "Expired";

/**
 * Numeric status codes for ERC-8183 job lifecycle.
 * These are status identifiers, NOT priority/sort ranks.
 *
 * Status code assignment follows the ERC-8183 terminal state precedence:
 * if a job has both Completed and Rejected events, the code is 3 (Completed).
 * The precedence is enforced in projection logic, not by numeric ordering.
 */
export const JOB_STATUS_CODE: Record<JobStatus, number> = {
  Open: 0,
  Funded: 1,
  Submitted: 2,
  Completed: 3,
  Rejected: 4,
  Expired: 5,
};

/** @deprecated Use JOB_STATUS_CODE. Kept for migration compat. */
export const JOB_STATUS_PRIORITY = JOB_STATUS_CODE;

export type ProjectedJob = {
  id: string;
  client: Address;
  provider: Address;
  evaluator: Address;
  hook: Address;
  expiredAt: string;
  description: string;
  budget: string;
  fundedAmount: string;
  createdAtBlock: string;
  updatedAtBlock: string;
  deliverable: `0x${string}`;
  completionReason: `0x${string}`;
  rejector: Address | undefined;
  /** Numeric status matching JOB_STATUS_PRIORITY. */
  status: number;
  statusLabel: JobStatus;
  createdAt: string;
  events: IndexedJobEvent[];
};

// ── Projected agent ────────────────────────────────────────────────────────

export type ProjectedAgent = {
  agentId: string;
  tokenId: string;
  controller: Address;
  metadataURI: string;
  registeredAtBlock: string;
  transactionHash: `0x${string}`;
  skillHash?: `0x${string}`;
  source: string;
  chainId: number;
  registryAddress?: Address;
  contractAddress?: Address;
};

// ── Overview summary ───────────────────────────────────────────────────────

export type OverviewSummary = {
  eventCount: number;
  jobs: number;
  agents: number;
  proofs: number;
  budgetedUsdc: string;
  fundedUsdc: string;
  totalBudgetAtomic: string;
  totalFundedAtomic: string;
  totalBudget: string;
  totalFunded: string;
  settledJobs: number;
  fundedJobs: number;
};

export type OverviewProjection = {
  summary: OverviewSummary;
  jobs: ProjectedJob[];
  agents: ProjectedAgent[];
  proofs: unknown[];
};
