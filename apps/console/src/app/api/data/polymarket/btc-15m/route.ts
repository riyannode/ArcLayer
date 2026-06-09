import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { fetchBtc15mMarket } from '@/lib/polymarket/btc15m';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const data = await fetchBtc15mMarket();
  return humanJson(req, data, { status: data.ok ? 200 : 404 });
}
