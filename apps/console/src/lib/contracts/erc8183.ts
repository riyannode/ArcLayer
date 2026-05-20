import { decodeEventLog, type Hex, type Log } from 'viem';
import { ERC8183_AGENTIC_COMMERCE_ABI } from '@arclayer/sdk';

/**
 * Official Arc ERC-8183 AgenticCommerce ABI.
 *
 * Source of truth is the workspace SDK ABI, which mirrors the deployed Arc
 * Testnet reference contract at CONTRACTS.ERC8183_AGENTIC_COMMERCE.
 */
export const ERC8183_ABI = ERC8183_AGENTIC_COMMERCE_ABI;

/**
 * Official ERC-8183 job status values verified against the repo's deployed ABI
 * and indexer projection. There is NO on-chain Claimed state in this contract;
 * A2A claim remains an off-chain queue state only.
 *
 * Budget/payment amounts for ERC-8183 are ERC-20 USDC atomic units (6 decimals):
 * 1 USDC = 1_000_000. Do not mix with Arc native USDC gas balances (18 decimals).
 */
export enum ERC8183JobStatus {
  Created = 0,
  BudgetSet = 1,
  Funded = 2,
  Submitted = 3,
  Completed = 4,
}

export const ERC8183_STATUS_LABELS: Record<ERC8183JobStatus, string> = {
  [ERC8183JobStatus.Created]: 'Created',
  [ERC8183JobStatus.BudgetSet]: 'BudgetSet',
  [ERC8183JobStatus.Funded]: 'Funded',
  [ERC8183JobStatus.Submitted]: 'Submitted',
  [ERC8183JobStatus.Completed]: 'Completed',
};

export function getERC8183StatusLabel(status: number | bigint | null | undefined): string {
  if (status === null || status === undefined) return 'Unknown';
  const numeric = Number(status);
  return ERC8183_STATUS_LABELS[numeric as ERC8183JobStatus] ?? `Unknown(${numeric})`;
}

export type JobCreatedEvent = {
  eventName: 'JobCreated';
  jobId: bigint;
  client: `0x${string}`;
  provider: `0x${string}`;
  evaluator: `0x${string}`;
  expiredAt: bigint;
  hook: `0x${string}`;
};

export type BudgetSetEvent = {
  eventName: 'BudgetSet';
  jobId: bigint;
  /** ERC-20 USDC atomic amount (6 decimals), not native 18-decimal gas balance. */
  amount: bigint;
};

export type JobFundedEvent = {
  eventName: 'JobFunded';
  jobId: bigint;
  /** ERC-20 USDC atomic amount (6 decimals), not native 18-decimal gas balance. */
  amount: bigint;
};

export type JobSubmittedEvent = {
  eventName: 'JobSubmitted';
  jobId: bigint;
  deliverable: Hex;
};

export type JobCompletedEvent = {
  eventName: 'JobCompleted';
  jobId: bigint;
  reason: Hex;
};

export type ERC8183JobLifecycleEvent =
  | JobCreatedEvent
  | BudgetSetEvent
  | JobFundedEvent
  | JobSubmittedEvent
  | JobCompletedEvent;

type ERC8183EventName = ERC8183JobLifecycleEvent['eventName'];

type EventLogLike = Pick<Log, 'data' | 'topics'>;

function decodeERC8183Event(log: EventLogLike, eventName: ERC8183EventName): ERC8183JobLifecycleEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: ERC8183_ABI,
      data: log.data,
      topics: log.topics,
    });

    if (decoded.eventName !== eventName) return null;
    return {
      eventName: decoded.eventName,
      ...(decoded.args as Record<string, unknown>),
    } as ERC8183JobLifecycleEvent;
  } catch {
    return null;
  }
}

export function parseJobCreated(log: EventLogLike): JobCreatedEvent | null {
  return decodeERC8183Event(log, 'JobCreated') as JobCreatedEvent | null;
}

export function parseBudgetSet(log: EventLogLike): BudgetSetEvent | null {
  return decodeERC8183Event(log, 'BudgetSet') as BudgetSetEvent | null;
}

export function parseJobFunded(log: EventLogLike): JobFundedEvent | null {
  return decodeERC8183Event(log, 'JobFunded') as JobFundedEvent | null;
}

export function parseJobSubmitted(log: EventLogLike): JobSubmittedEvent | null {
  return decodeERC8183Event(log, 'JobSubmitted') as JobSubmittedEvent | null;
}

export function parseJobCompleted(log: EventLogLike): JobCompletedEvent | null {
  return decodeERC8183Event(log, 'JobCompleted') as JobCompletedEvent | null;
}

export function parseERC8183JobLifecycleEvent(log: EventLogLike): ERC8183JobLifecycleEvent | null {
  for (const eventName of ['JobCreated', 'BudgetSet', 'JobFunded', 'JobSubmitted', 'JobCompleted'] as const) {
    const parsed = decodeERC8183Event(log, eventName);
    if (parsed) return parsed;
  }
  return null;
}
