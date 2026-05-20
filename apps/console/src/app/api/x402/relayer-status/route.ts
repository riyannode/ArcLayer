import { NextResponse } from 'next/server';
import { createPublicClient, formatUnits, getAddress, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ARC_TESTNET_CHAIN_ID, USDC_ADDRESS } from '@/lib/x402';

export const runtime = 'nodejs';

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

function getRelayerAddress() {
  const configured = process.env.X402_RELAYER_ADDRESS;
  if (configured) return getAddress(configured);

  const pk = process.env.X402_RELAYER_PRIVATE_KEY;
  if (!pk) return null;
  return privateKeyToAccount(pk as `0x${string}`).address;
}

export async function GET() {
  const relayerAddress = getRelayerAddress();
  const configured = Boolean(relayerAddress);

  if (!relayerAddress) {
    return NextResponse.json({
      configured: false,
      ready: false,
      relayerAddress: null,
      usdcBalanceAtomic: '0',
      usdcBalance: '0',
      chainId: ARC_TESTNET_CHAIN_ID,
      asset: getAddress(USDC_ADDRESS),
      error: 'X402_RELAYER_PRIVATE_KEY or X402_RELAYER_ADDRESS is not configured',
    });
  }

  try {
    const client = createPublicClient({ transport: http(process.env.ARC_RPC_URL ?? 'https://rpc.drpc.testnet.arc.network') });
    const balance = await client.readContract({
      address: getAddress(USDC_ADDRESS),
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [relayerAddress],
    });

    return NextResponse.json({
      configured,
      ready: balance > BigInt(0),
      relayerAddress,
      usdcBalanceAtomic: balance.toString(),
      usdcBalance: formatUnits(balance, 6),
      chainId: ARC_TESTNET_CHAIN_ID,
      asset: getAddress(USDC_ADDRESS),
      settleMode: process.env.X402_SETTLE_MODE || 'self-hosted',
    });
  } catch (error) {
    return NextResponse.json({
      configured,
      ready: false,
      relayerAddress,
      usdcBalanceAtomic: '0',
      usdcBalance: '0',
      chainId: ARC_TESTNET_CHAIN_ID,
      asset: getAddress(USDC_ADDRESS),
      error: error instanceof Error ? error.message : String(error),
    }, { status: 503 });
  }
}
