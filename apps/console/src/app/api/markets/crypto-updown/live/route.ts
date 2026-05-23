import { NextRequest, NextResponse } from 'next/server';
import { getLiveSnapshot } from '@/lib/markets/polymarket/snapshot';
import type { Asset } from '@/lib/markets/polymarket/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const LIVE_TTL_MS = 60_000;
const LIVE_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=120';
const liveCache = new Map<Asset, { expiresAt: number; payload: unknown }>();

export async function GET(request: NextRequest) {
  try {
    const assetQuery = (request.nextUrl.searchParams.get('asset') || 'BTC').toUpperCase();
    const asset: Asset = assetQuery === 'ETH' ? 'ETH' : 'BTC';
    const cached = liveCache.get(asset);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, {
        headers: { 'Cache-Control': LIVE_CACHE_CONTROL },
      });
    }
    const snapshot = await getLiveSnapshot(asset);
    if (!snapshot) return NextResponse.json({ ok: false, error: 'no_active_market' }, { status: 404 });
    const payload = { ok: true, data: snapshot };
    liveCache.set(asset, { expiresAt: Date.now() + LIVE_TTL_MS, payload });
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': LIVE_CACHE_CONTROL },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'snapshot_fetch_failed' },
      { headers: { 'Cache-Control': LIVE_CACHE_CONTROL } },
    );
  }
}
