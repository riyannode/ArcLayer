import { describe, expect, it } from 'vitest';
import { encodeEventTopics, encodeAbiParameters, zeroAddress, type Address, type TransactionReceipt } from 'viem';
import {
  ERC8004_ABI,
  ERC8004_IDENTITY_REGISTRY_ADDRESS,
  extractERC8004MintedTokenIdFromReceipt,
  parseERC8004TransferMint,
} from './erc8004';

const controller = '0x1111111111111111111111111111111111111111' as Address;
const other = '0x2222222222222222222222222222222222222222' as Address;
const wrongContract = '0x3333333333333333333333333333333333333333' as Address;

function transferLog({
  from = zeroAddress,
  to = controller,
  tokenId = 123n,
  address = ERC8004_IDENTITY_REGISTRY_ADDRESS,
}: {
  from?: Address;
  to?: Address;
  tokenId?: bigint;
  address?: Address;
} = {}): TransactionReceipt['logs'][number] {
  const topics = encodeEventTopics({
    abi: ERC8004_ABI,
    eventName: 'Transfer',
    args: { from, to, tokenId },
  });

  return {
    address,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
    data: encodeAbiParameters([], []),
    blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    blockNumber: 1n,
    transactionHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}

describe('ERC-8004 mint receipt helpers', () => {
  it('returns tokenId for a valid Transfer mint from ERC8004 registry', () => {
    const log = transferLog({ tokenId: 987654321n });

    expect(parseERC8004TransferMint(log, controller)).toBe(987654321n);
    expect(extractERC8004MintedTokenIdFromReceipt({ logs: [log] }, controller)).toBe(987654321n);
  });

  it('ignores Transfer logs from the wrong contract', () => {
    const log = transferLog({ address: wrongContract });

    expect(parseERC8004TransferMint(log, controller)).toBeNull();
    expect(() => extractERC8004MintedTokenIdFromReceipt({ logs: [log] }, controller)).toThrow(
      /ERC-8004 mint Transfer event not found/,
    );
  });

  it('ignores non-mint Transfer logs', () => {
    const log = transferLog({ from: other });

    expect(parseERC8004TransferMint(log, controller)).toBeNull();
  });

  it('ignores mint Transfer logs when expectedTo mismatches', () => {
    const log = transferLog({ to: controller });

    expect(parseERC8004TransferMint(log, other)).toBeNull();
  });

  it('throws a clear error when no mint event is found', () => {
    expect(() => extractERC8004MintedTokenIdFromReceipt({ logs: [] }, controller)).toThrow(
      /ERC-8004 mint Transfer event not found/,
    );
  });
});
