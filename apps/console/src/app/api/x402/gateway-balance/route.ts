import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, getAddress, formatUnits } from 'viem';

export const runtime = 'nodejs';

const ARC_RPC = 'https://rpc.testnet.arc.network';
const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;
const USDC = '0x3600000000000000000000000000000000000000' as const;

// GatewayWallet exposes balanceOf(token, depositor) for per-wallet deposits.
// Fallback: read USDC.balanceOf(GatewayWallet) if per-user not available.
const GATEWAY_BALANCE_ABI = [
  {
    name: 'deposits',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address query param required' }, { status: 400 });
  }

  let checksummed: `0x${string}`;
  try {
    checksummed = getAddress(address);
  } catch {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 });
  }

  const client = createPublicClient({ transport: http(ARC_RPC) });

  try {
    // Try per-depositor balance first
    const deposited = await client.readContract({
      address: GATEWAY_WALLET,
      abi: GATEWAY_BALANCE_ABI,
      functionName: 'deposits',
      args: [USDC, checksummed],
    });
    return NextResponse.json({
      address: checksummed,
      gateway: GATEWAY_WALLET,
      depositedUsdc: formatUnits(deposited, 6),
      depositedRaw: deposited.toString(),
      method: 'per_depositor',
    });
  } catch {
    // Fallback: read USDC balance of GatewayWallet (pool total, not per-user)
    try {
      const poolBalance = await client.readContract({
        address: USDC,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [GATEWAY_WALLET],
      });
      return NextResponse.json({
        address: checksummed,
        gateway: GATEWAY_WALLET,
        depositedUsdc: null,
        poolUsdc: formatUnits(poolBalance, 6),
        poolRaw: poolBalance.toString(),
        method: 'pool_fallback',
        note: 'Per-depositor balance not available. Showing total pool.',
      });
    } catch (e) {
      return NextResponse.json({
        error: 'rpc_failed',
        detail: e instanceof Error ? e.message : String(e),
      }, { status: 502 });
    }
  }
}
