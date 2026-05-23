import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, formatUnits, getAddress, http } from 'viem';
import { GATEWAY_WALLET_ABI } from '@/lib/x402/gateway/abi';
import { GATEWAY_WALLET_ADDRESS, USDC_ADDRESS } from '@/lib/x402/constants';

export const runtime = 'nodejs';

const ARC_RPC_URL = process.env.ARC_RPC_URL || process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';

export async function GET(req: NextRequest) {
  const rawAddress = req.nextUrl.searchParams.get('address');
  if (!rawAddress) {
    return NextResponse.json({
      depositedUsdc: null,
      method: 'error',
      error: 'address is required',
    }, { status: 400 });
  }

  let depositor: `0x${string}`;
  try {
    depositor = getAddress(rawAddress);
  } catch {
    return NextResponse.json({
      depositedUsdc: null,
      method: 'error',
      error: 'invalid address',
    }, { status: 400 });
  }

  try {
    const client = createPublicClient({ transport: http(ARC_RPC_URL) });
    const depositedAtomic = await client.readContract({
      address: getAddress(GATEWAY_WALLET_ADDRESS),
      abi: GATEWAY_WALLET_ABI,
      functionName: 'deposits',
      args: [depositor, getAddress(USDC_ADDRESS)],
    });

    return NextResponse.json({
      depositedUsdc: formatUnits(depositedAtomic, 6),
      depositedAtomic: depositedAtomic.toString(),
      method: 'gateway-wallet',
    });
  } catch (err) {
    return NextResponse.json({
      depositedUsdc: null,
      method: 'error',
      error: err instanceof Error ? err.message : 'failed_to_read_gateway_balance',
    }, { status: 500 });
  }
}
