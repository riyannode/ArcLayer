import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type TransactionReceipt } from 'viem';
import {
  ERC8183_ABI,
  ERC8183_AGENTIC_COMMERCE_ADDRESS,
  extractBudgetSetFromReceipt,
  extractJobCreatedIdFromReceipt,
  formatERC20UsdcAmount,
  getERC8183StatusLabel,
  parseERC20UsdcAmount,
} from './onchain';

const wrongContract = '0x3333333333333333333333333333333333333333' as Address;
const client = '0x1111111111111111111111111111111111111111' as Address;
const provider = '0x2222222222222222222222222222222222222222' as Address;
const evaluator = '0x4444444444444444444444444444444444444444' as Address;
const hook = '0x5555555555555555555555555555555555555555' as Address;

function receiptLog({
  eventName,
  topicsArgs,
  dataParams,
  address = ERC8183_AGENTIC_COMMERCE_ADDRESS,
}: {
  eventName: 'JobCreated' | 'BudgetSet';
  topicsArgs: Record<string, unknown>;
  dataParams: readonly { type: string; value: unknown }[];
  address?: Address;
}): TransactionReceipt['logs'][number] {
  const topics = encodeEventTopics({
    abi: ERC8183_ABI,
    eventName,
    args: topicsArgs,
  });

  return {
    address,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    data: encodeAbiParameters(
      dataParams.map((param) => ({ type: param.type })),
      dataParams.map((param) => param.value),
    ) as Hex,
    blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    blockNumber: 1n,
    transactionHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}

function jobCreatedLog(address?: Address) {
  return receiptLog({
    eventName: 'JobCreated',
    topicsArgs: { jobId: 42n, client, provider },
    dataParams: [
      { type: 'address', value: evaluator },
      { type: 'uint256', value: 123456789n },
      { type: 'address', value: hook },
    ],
    address,
  });
}

function budgetSetLog(address?: Address) {
  return receiptLog({
    eventName: 'BudgetSet',
    topicsArgs: { jobId: 42n },
    dataParams: [{ type: 'uint256', value: 1_000_000n }],
    address,
  });
}

describe('ERC-8183 A2A on-chain helpers', () => {
  it('parses and formats ERC-20 USDC with 6 decimals', () => {
    expect(parseERC20UsdcAmount('1')).toBe(1_000_000n);
    expect(formatERC20UsdcAmount(1_000_000n)).toBe('1');
  });

  it('labels official ERC-8183 statuses 0..4 and keeps unknown statuses explicit', () => {
    expect(getERC8183StatusLabel(0)).toBe('Created');
    expect(getERC8183StatusLabel(1)).toBe('BudgetSet');
    expect(getERC8183StatusLabel(2)).toBe('Funded');
    expect(getERC8183StatusLabel(3)).toBe('Submitted');
    expect(getERC8183StatusLabel(4)).toBe('Completed');
    expect(getERC8183StatusLabel(99)).toBe('Unknown(99)');
  });

  it('extracts lifecycle events from receipts', () => {
    expect(extractJobCreatedIdFromReceipt({ logs: [jobCreatedLog()] })).toBe(42n);
    expect(extractBudgetSetFromReceipt({ logs: [budgetSetLog()] })).toEqual({
      eventName: 'BudgetSet',
      jobId: 42n,
      amount: 1_000_000n,
    });
  });

  it('ignores wrong events and throws a clear error when the expected event is missing', () => {
    expect(() => extractJobCreatedIdFromReceipt({ logs: [budgetSetLog()] })).toThrow(/JobCreated event not found/);
    expect(() => extractJobCreatedIdFromReceipt({ logs: [jobCreatedLog(wrongContract)] })).toThrow(
      /JobCreated event not found/,
    );
  });
});
