import { NextResponse } from 'next/server';
import { fetchBtc15mMarket } from '@/lib/polymarket/btc15m';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await fetchBtc15mMarket();
  return NextResponse.json(data, { status: data.ok ? 200 : 404 });
}
