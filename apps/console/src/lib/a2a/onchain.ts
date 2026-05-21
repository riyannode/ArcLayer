import { formatUnits, getAddress, parseUnits, type Address, type PublicClient, type TransactionReceipt } from 'viem';
import { CONTRACTS } from '@arclayer/sdk';
import {
  ERC8183_ABI,
  ERC8183JobStatus,
  ERC8183_USDC_DECIMALS,
  getERC8183StatusLabel,
  parseERC8183JobLifecycleEvent,
  type BudgetSetEvent,
  type JobCompletedEvent,
  type JobCreatedEvent,
  type JobFundedEvent,
  type JobSubmittedEvent,
} from '@/lib/contracts/erc8183';

export {
  ERC8183_ABI,
  ERC8183JobStatus,
  ERC8183_USDC_DECIMALS,
  getERC8183StatusLabel,
  parseERC8183JobLifecycleEvent,
};

export const ERC8183_AGENTIC_COMMERCE_ADDRESS = CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address;

export type ERC8183Job = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  /** ERC-20 USDC atomic amount (6 decimals), never native Arc 18-decimal units. */
  budget: bigint;
  expiredAt: bigint;
  status: ERC8183JobStatus;
  hook: Address;
};

type ReadContractClient = Pick<PublicClient, 'readContract'>;

type ReceiptLike = Pick<TransactionReceipt, 'logs'>;

function sameAddress(a: string, b: string): boolean {
  return getAddress(a as Address) === getAddress(b as Address);
}

function normalizeJob(raw: unknown): ERC8183Job {
  const job = raw as {
    id: bigint;
    client: Address;
    provider: Address;
    evaluator: Address;
    description: string;
    budget: bigint;
    expiredAt: bigint;
    status: number;
    hook: Address;
  };

  return {
    ...job,
    client: getAddress(job.client),
    provider: getAddress(job.provider),
    evaluator: getAddress(job.evaluator),
    hook: getAddress(job.hook),
    status: Number(job.status) as ERC8183JobStatus,
  };
}

export async function getERC8183Job(client: ReadContractClient, jobId: bigint | string): Promise<ERC8183Job> {
  const raw = await client.readContract({
    address: ERC8183_AGENTIC_COMMERCE_ADDRESS,
    abi: ERC8183_ABI,
    functionName: 'getJob',
    args: [BigInt(jobId)],
  });

  return normalizeJob(raw);
}

export async function getERC8183JobStatus(
  client: ReadContractClient,
  jobId: bigint | string,
): Promise<ERC8183JobStatus> {
  const job = await getERC8183Job(client, jobId);
  return job.status;
}

export async function assertERC8183Provider(
  client: ReadContractClient,
  jobId: bigint | string,
  expectedProvider: Address,
): Promise<ERC8183Job> {
  const job = await getERC8183Job(client, jobId);
  if (!sameAddress(job.provider, expectedProvider)) {
    throw new Error(
      `ERC-8183 provider mismatch for job ${jobId}: expected ${getAddress(expectedProvider)}, got ${job.provider}.`,
    );
  }
  return job;
}

export async function assertERC8183Evaluator(
  client: ReadContractClient,
  jobId: bigint | string,
  expectedEvaluator: Address,
): Promise<ERC8183Job> {
  const job = await getERC8183Job(client, jobId);
  if (!sameAddress(job.evaluator, expectedEvaluator)) {
    throw new Error(
      `ERC-8183 evaluator mismatch for job ${jobId}: expected ${getAddress(expectedEvaluator)}, got ${job.evaluator}.`,
    );
  }
  return job;
}

function extractEventFromReceipt<TEvent extends { eventName: string }>(
  receipt: ReceiptLike,
  eventName: TEvent['eventName'],
): TEvent {
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, ERC8183_AGENTIC_COMMERCE_ADDRESS)) continue;
    const parsed = parseERC8183JobLifecycleEvent(log);
    if (parsed?.eventName === eventName) return parsed as unknown as TEvent;
  }

  throw new Error(
    `ERC-8183 ${eventName} event not found in transaction receipt from ${ERC8183_AGENTIC_COMMERCE_ADDRESS}.`,
  );
}

export function extractJobCreatedIdFromReceipt(receipt: ReceiptLike): bigint {
  return extractEventFromReceipt<JobCreatedEvent>(receipt, 'JobCreated').jobId;
}

export function extractBudgetSetFromReceipt(receipt: ReceiptLike): BudgetSetEvent {
  return extractEventFromReceipt<BudgetSetEvent>(receipt, 'BudgetSet');
}

export function extractJobFundedFromReceipt(receipt: ReceiptLike): JobFundedEvent {
  return extractEventFromReceipt<JobFundedEvent>(receipt, 'JobFunded');
}

export function extractJobSubmittedFromReceipt(receipt: ReceiptLike): JobSubmittedEvent {
  return extractEventFromReceipt<JobSubmittedEvent>(receipt, 'JobSubmitted');
}

export function extractJobCompletedFromReceipt(receipt: ReceiptLike): JobCompletedEvent {
  return extractEventFromReceipt<JobCompletedEvent>(receipt, 'JobCompleted');
}

export function parseERC20UsdcAmount(value: string): bigint {
  return parseUnits(value, ERC8183_USDC_DECIMALS);
}

export function formatERC20UsdcAmount(amount: bigint): string {
  return formatUnits(amount, ERC8183_USDC_DECIMALS);
}
