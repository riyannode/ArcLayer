import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, formatUnits, getAddress, http } from 'viem';
import { GATEWAY_WALLET_ADDRESS, USDC_ADDRESS } from '@/lib/x402/constants';
import { ERC20_ABI, GATEWAY_WALLET_ABI } from '@/lib/x402/gateway/abi';

export const runtime = 'nodejs';

const ARC_RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';

// Safe diagnostics — log presence only, never values.
console.log('[gateway-balance] env', {
  hasCircleClientKey: Boolean(process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY),
  hasCircleClientUrl: Boolean(process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL),
  rpcHost: (() => { try { return new URL(ARC_RPC).host; } catch { return 'invalid-url'; } })(),
});

export async function GET(req: NextRequest) {
  const rawAddress = req.nextUrl.searchParams.get('address');

  if (!rawAddress) {
    return NextResponse.json(
      { error: 'address query param required' },
      { status: 400 },
    );
  }

  let depositor: `0x${string}`;

  try {
    depositor = getAddress(rawAddress);
  } catch {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 });
  }

  const client = createPublicClient({ transport: http(ARC_RPC) });
  const gateway = getAddress(GATEWAY_WALLET_ADDRESS);
  const usdc = getAddress(USDC_ADDRESS);

  try {
    const [
      walletUsdc,
      gatewayAvailable,
      gatewayTotal,
      gatewayWithdrawing,
      gatewayWithdrawable,
      withdrawalBlock,
      withdrawalDelay,
      currentBlock,
    ] = await Promise.all([
      client.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [depositor],
      }),
      client.readContract({
        address: gateway,
        abi: GATEWAY_WALLET_ABI,
        functionName: 'availableBalance',
        args: [usdc, depositor],
      }),
      client.readContract({
        address: gateway,
        abi: GATEWAY_WALLET_ABI,
        functionName: 'totalBalance',
        args: [usdc, depositor],
      }),
      client.readContract({
        address: gateway,
        abi: GATEWAY_WALLET_ABI,
        functionName: 'withdrawingBalance',
        args: [usdc, depositor],
      }),
      client.readContract({
        address: gateway,
        abi: GATEWAY_WALLET_ABI,
        functionName: 'withdrawableBalance',
        args: [usdc, depositor],
      }),
      client.readContract({
        address: gateway,
        abi: GATEWAY_WALLET_ABI,
        functionName: 'withdrawalBlock',
        args: [usdc, depositor],
      }),
      client.readContract({
        address: gateway,
        abi: GATEWAY_WALLET_ABI,
        functionName: 'withdrawalDelay',
      }),
      client.getBlockNumber(),
    ]);

    const blocksRemaining =
      withdrawalBlock > currentBlock ? withdrawalBlock - currentBlock : BigInt(0);

    return NextResponse.json({
      address: depositor,
      token: usdc,
      gatewayWallet: gateway,

      walletUsdc: formatUnits(walletUsdc, 6),
      walletAtomic: walletUsdc.toString(),

      gatewayAvailableUsdc: formatUnits(gatewayAvailable, 6),
      gatewayAvailableAtomic: gatewayAvailable.toString(),

      // Backward compatibility for older x402 UI code.
      // depositedUsdc means available Gateway balance ready to spend.
      depositedUsdc: formatUnits(gatewayAvailable, 6),
      depositedAtomic: gatewayAvailable.toString(),

      gatewayTotalUsdc: formatUnits(gatewayTotal, 6),
      gatewayTotalAtomic: gatewayTotal.toString(),

      withdrawingUsdc: formatUnits(gatewayWithdrawing, 6),
      withdrawingAtomic: gatewayWithdrawing.toString(),

      withdrawableUsdc: formatUnits(gatewayWithdrawable, 6),
      withdrawableAtomic: gatewayWithdrawable.toString(),

      withdrawalBlock: withdrawalBlock.toString(),
      withdrawalDelayBlocks: withdrawalDelay.toString(),
      currentBlock: currentBlock.toString(),
      blocksRemaining: blocksRemaining.toString(),

      method: 'gateway-wallet-v2',
    });
  } catch (err) {
    console.error('[gateway-balance] read failed', {
      rpcHost: (() => { try { return new URL(ARC_RPC).host; } catch { return 'invalid-url'; } })(),
      error: err instanceof Error ? err.message : String(err),
    });

    return NextResponse.json(
      {
        method: 'error',
        error: 'failed_to_read_gateway_balances',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
