/**
 * Profile — USDC balances for owner + agent account.
 *
 * GET /api/profile/balances?owner=0x...&agentAccount=0x...
 *
 * Read-only. No private keys. No tx execution.
 * Uses viem public client to read ERC-20 balanceOf.
 * Uses Gateway REST API for unified balance (on-chain deposits() removed in contract upgrade).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, isAddress, getAddress, parseUnits, type Hex } from 'viem';
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

/** Arc Testnet CCTP domain for Gateway balance queries. */
const ARC_GATEWAY_DOMAIN = 26;
const GATEWAY_API_BASE = process.env.GATEWAY_API_URL || 'https://gateway-api-testnet.circle.com/v1';

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

/**
 * Query Gateway unified balance via Circle REST API.
 * The on-chain `deposits(address,address)` was removed in a contract upgrade;
 * the REST API is the canonical way to read Gateway balances.
 */
async function getGatewayBalance(address: string): Promise<{ raw: string; formatted: string } | null> {
  try {
    const res = await fetch(`${GATEWAY_API_BASE}/balances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'USDC',
        sources: [{ domain: ARC_GATEWAY_DOMAIN, depositor: getAddress(address) }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data?.balances?.find(
      (b: { domain: number; depositor: string }) =>
        b.domain === ARC_GATEWAY_DOMAIN && b.depositor.toLowerCase() === address.toLowerCase(),
    );
    if (!entry || !entry.balance) return { raw: '0', formatted: '0.000000' };
    // Gateway API returns decimal string like "3.000000"
    const raw = parseUnits(entry.balance, USDC_DECIMALS);
    return { raw: raw.toString(), formatted: entry.balance };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get('owner');
  const agentAccount = req.nextUrl.searchParams.get('agentAccount');

  if (!owner || !isAddress(owner)) {
    return NextResponse.json({ ok: false, error: 'invalid_owner' }, { status: 400 });
  }

  const [ownerBalance, ownerGateway] = await Promise.all([
    getUsdcBalance(owner),
    getGatewayBalance(owner),
  ]);

  let agentBalance: { raw: string; formatted: string } | null = null;
  let agentGateway: { raw: string; formatted: string } | null = null;
  if (agentAccount && isAddress(agentAccount)) {
    const [ab, ag] = await Promise.all([
      getUsdcBalance(agentAccount),
      getGatewayBalance(agentAccount),
    ]);
    agentBalance = ab;
    agentGateway = ag;
  }

  return NextResponse.json({
    ok: true,
    owner: {
      address: getAddress(owner),
      usdc: ownerBalance,
      gateway: ownerGateway,
    },
    agentAccount: agentAccount && isAddress(agentAccount)
      ? {
          address: getAddress(agentAccount),
          usdc: agentBalance,
          gateway: agentGateway,
        }
      : null,
    network: 'Arc Testnet',
    chainId: 5042002,
  });
}
