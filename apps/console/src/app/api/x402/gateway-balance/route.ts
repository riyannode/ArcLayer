import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress, parseUnits } from 'viem';

export const runtime = 'nodejs';

const ARC_GATEWAY_DOMAIN = 26;
const GATEWAY_API_BASE = process.env.GATEWAY_API_URL || 'https://gateway-api-testnet.circle.com/v1';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: 'valid address query param required' }, { status: 400 });
  }

  const depositor = getAddress(address);

  try {
    const res = await fetch(`${GATEWAY_API_BASE}/balances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: 'USDC',
        sources: [{ domain: ARC_GATEWAY_DOMAIN, depositor }],
      }),
    });

    if (!res.ok) {
      return NextResponse.json({
        depositedUsdc: null,
        method: 'gateway-api',
        error: `Gateway API returned ${res.status}`,
      }, { status: 502 });
    }

    const data = await res.json();
    const entry = data?.balances?.find(
      (b: { domain: number; depositor: string }) =>
        b.domain === ARC_GATEWAY_DOMAIN && b.depositor.toLowerCase() === depositor.toLowerCase(),
    );

    if (!entry || !entry.balance) {
      return NextResponse.json({
        depositedUsdc: '0.000000',
        depositedAtomic: '0',
        method: 'gateway-api',
      });
    }

    const raw = parseUnits(entry.balance, 6);

    return NextResponse.json({
      depositedUsdc: entry.balance,
      depositedAtomic: raw.toString(),
      method: 'gateway-api',
    });
  } catch {
    return NextResponse.json({
      depositedUsdc: null,
      method: 'error',
      error: 'failed_to_query_gateway_api',
    }, { status: 502 });
  }
}
