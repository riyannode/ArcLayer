import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, getAddress, http } from 'viem';
import { GATEWAY_WALLET_ADDRESS, USDC_ADDRESS } from '@/lib/x402/constants';

export const runtime = 'nodejs';

const ARC_RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';

const GATEWAY_BALANCE_ABI = [
  {
    name: 'deposits',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'depositor', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address query param required' }, { status: 400 });
  }

  let depositor: `0x${string}`;
  try {
    depositor = getAddress(address);
  } catch {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 });
  }

  const client = createPublicClient({ transport: http(ARC_RPC) });

  try {
    const deposited = await client.readContract({
      address: GATEWAY_WALLET_ADDRESS,
      abi: GATEWAY_BALANCE_ABI,
      functionName: 'deposits',
      args: [depositor, USDC_ADDRESS],
    });

    return NextResponse.json({
      depositedUsdc: deposited.toString(),
      depositedAtomic: deposited.toString(),
      method: 'gateway-wallet',
    });
  } catch {
    return NextResponse.json({
      depositedUsdc: null,
      method: 'error',
      error: 'failed_to_read_gateway_balance',
    }, { status: 502 });
  }
}
