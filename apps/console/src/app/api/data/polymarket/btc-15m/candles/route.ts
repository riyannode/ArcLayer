import { NextResponse } from 'next/server';
import { fetchBtc15mMarket, fetchPriceHistory, payloadHash } from '@/lib/polymarket/btc15m';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HistoryPoint = { t?: number; p?: number } | Record<string, unknown>;

function toCandle(point: HistoryPoint, previous: HistoryPoint | null) {
  const timestamp = Number((point as { t?: unknown }).t ?? Date.now() / 1000);
  const close = Number((point as { p?: unknown }).p ?? 0);
  const open = Number((previous as { p?: unknown } | null)?.p ?? close);
  const high = Math.max(open, close);
  const low = Math.min(open, close);
  return {
    timestamp,
    open,
    high,
    low,
    close,
  };
}

export async function GET() {
  const market = await fetchBtc15mMarket();
  if (!market.ok) {
    return NextResponse.json({
      ok: false,
      source: 'price-feed',
      asset: 'BTC',
      timeframe: '15m',
      error: 'no_active_btc_15m_market',
      candles: [],
      livePrice: null,
      fetchedAt: new Date().toISOString(),
      payloadHash: market.payloadHash,
    }, { status: 404 });
  }

  const activeMarket = market as any;
  const marketId = activeMarket.conditionId || activeMarket.tokenIds.up;
  const history = marketId ? await fetchPriceHistory(marketId, '1h', '72') : [];
  const candles = history.slice(-24).map((point: HistoryPoint, idx: number, arr: HistoryPoint[]) => toCandle(point, idx > 0 ? arr[idx - 1] : null));
  const livePrice = candles.at(-1)?.close ?? activeMarket.upPrice ?? null;
  const payload = {
    ok: true,
    source: 'price-feed',
    asset: 'BTC',
    timeframe: '15m',
    marketSlug: activeMarket.marketSlug,
    conditionId: activeMarket.conditionId,
    candles,
    livePrice,
    rawHistoryPoints: history.length,
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json({ ...payload, payloadHash: payloadHash(payload) });
}
