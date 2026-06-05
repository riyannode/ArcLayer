/**
 * Profile — USDC balances for owner + agent account.
 *
 * GET /api/profile/balances?owner=0x...&agentAccount=0x...
 *
 * Read-only. No private keys. No tx execution.
 * Uses viem public client to read ERC-20 balanceOf.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, isAddress, getAddress, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { ARC_RPC_URLS, ARC_TOKENS, ARC_ERC20_USDC_DECIMALS } from '@arclayer/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USDC_ADDRESS = ARC_TOKENS.USDC as Hex;
const USDC_DECIMALS = ARC_ERC20_USDC_DECIMALS;

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(process.env.ARC_RPC_URL || ARC_RPC_URLS[0]),
});

async function getUsdcBalance(address: string): Promise<{ raw: string; formatted: string }> {
  try {
    const raw = await client.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [getAddress(address)],
    });
    return { raw: raw.toString(), formatted: formatUnits(raw, USDC_DECIMALS) };
  } catch {
    return { raw: '0', formatted: '0.000000' };
  }
}

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get('owner');
  const agentAccount = req.nextUrl.searchParams.get('agentAccount');

  if (!owner || !isAddress(owner)) {
    return NextResponse.json({ ok: false, error: 'invalid_owner' }, { status: 400 });
  }

  const ownerBalance = await getUsdcBalance(owner);

  let agentBalance: { raw: string; formatted: string } | null = null;
  if (agentAccount && isAddress(agentAccount)) {
    agentBalance = await getUsdcBalance(agentAccount);
  }

  return NextResponse.json({
    ok: true,
    owner: { address: getAddress(owner), usdc: ownerBalance },
    agentAccount: agentAccount && isAddress(agentAccount)
      ? { address: getAddress(agentAccount), usdc: agentBalance }
      : null,
    network: 'Arc Testnet',
    chainId: 5042002,
  });
}
