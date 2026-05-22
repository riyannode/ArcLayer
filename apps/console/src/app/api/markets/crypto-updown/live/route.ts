import { NextRequest, NextResponse } from 'next/server';
import { getLiveSnapshot } from '@/lib/markets/polymarket/snapshot';
import type { Asset } from '@/lib/markets/polymarket/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const assetQuery = (request.nextUrl.searchParams.get('asset') || 'BTC').toUpperCase();
  const asset: Asset = assetQuery === 'ETH' ? 'ETH' : 'BTC';
  const snapshot = await getLiveSnapshot(asset);
  if (!snapshot) return NextResponse.json({ ok: false, error: 'no_active_market' }, { status: 404 });
  return NextResponse.json({ ok: true, data: snapshot });
}
