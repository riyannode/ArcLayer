import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  zeroAddress,
  type Address,
  type Log,
  type TransactionReceipt,
} from 'viem';
import { ARC_RPC_URLS, CONTRACTS, ERC8004_IDENTITY_REGISTRY_ABI } from '@arclayer/sdk';

export const ERC8004_ABI = ERC8004_IDENTITY_REGISTRY_ABI;
export const ERC8004_IDENTITY_REGISTRY_ADDRESS = CONTRACTS.ERC8004_IDENTITY_REGISTRY as Address;

function sameAddress(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export function parseERC8004TransferMint(log: Log, expectedTo?: Address): bigint | null {
  if (!sameAddress(log.address, ERC8004_IDENTITY_REGISTRY_ADDRESS)) return null;

  let decoded: ReturnType<typeof decodeEventLog<typeof ERC8004_ABI, 'Transfer'>>;
  try {
    decoded = decodeEventLog({
      abi: ERC8004_ABI,
      eventName: 'Transfer',
      data: log.data,
      topics: log.topics,
    });
  } catch {
    return null;
  }

  const { from, to, tokenId } = decoded.args;
  if (!sameAddress(from, zeroAddress)) return null;
  if (expectedTo && !sameAddress(to, expectedTo)) return null;

  return tokenId;
}

export function extractERC8004MintedTokenIdFromReceipt(
  receipt: Pick<TransactionReceipt, 'logs'>,
  expectedTo?: Address,
): bigint {
  for (const log of receipt.logs) {
    const tokenId = parseERC8004TransferMint(log, expectedTo);
    if (tokenId !== null) return tokenId;
  }

  const recipientHint = expectedTo ? ` for recipient ${getAddress(expectedTo)}` : '';
  throw new Error(
    `ERC-8004 mint Transfer event not found${recipientHint}. Expected Transfer(${zeroAddress}, controller, tokenId) from ${ERC8004_IDENTITY_REGISTRY_ADDRESS}.`,
  );
}

export async function getERC8004OwnerOf(agentId: bigint | string): Promise<Address> {
  const client = createPublicClient({
    transport: http(process.env.ARC_RPC_URL || ARC_RPC_URLS[0]),
  });

  return (await client.readContract({
    address: ERC8004_IDENTITY_REGISTRY_ADDRESS,
    abi: ERC8004_ABI,
    functionName: 'ownerOf',
    args: [BigInt(agentId)],
  })) as Address;
}
