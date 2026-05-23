import { NextResponse } from 'next/server';

/**
 * GET /api/a2a/btc-stream?asset=BTC|ETH
 *
 * Live spot price + 15m-aligned "Price to Beat" + candle history.
 * Used by the LiveMarketPanel widget on /live-a2a-agent.
 *
 * Sources:
 *   • Coinbase spot:    public, no key, fast.
 *   • Coinbase candles: 1m granularity, last ~25 minutes.
 *
 * "Price to Beat" = open price of the current 15m window (hackathon demo convention).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Candle = { t: number; o: number; h: number; l: number; c: number };

const PRODUCT_BY_ASSET: Record<'BTC' | 'ETH', string> = {
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
};

function fifteenMinAlignedSec(now = Math.floor(Date.now() / 1000)): number {
  return now - (now % 900);
}

async function fetchSpot(product: string, signal: AbortSignal): Promise<number | null> {
  const r = await fetch(`https://api.coinbase.com/v2/prices/${product}/spot`, {
    cache: 'no-store',
    signal,
  });
  if (!r.ok) return null;
  const j = await r.json();
  const n = parseFloat(j?.data?.amount);
  return Number.isFinite(n) ? n : null;
}

async function fetchCandles(product: string, signal: AbortSignal): Promise<Candle[]> {
  // Last 45 min of 1m candles → enough context for current/previous 15m windows.
  const end = Math.floor(Date.now() / 1000);
  const start = end - 60 * 45;
  const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=60&start=${new Date(
    start * 1000,
  ).toISOString()}&end=${new Date(end * 1000).toISOString()}`;
  const r = await fetch(url, { cache: 'no-store', signal });
  if (!r.ok) return [];
  const rows = (await r.json()) as Array<[number, number, number, number, number, number]>;
  // Coinbase returns [time, low, high, open, close, volume] descending by time
  return rows
    .map(([t, l, h, o, c]) => ({ t, o, h, l, c }))
    .sort((a, b) => a.t - b.t);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const assetRaw = (searchParams.get('asset') || 'BTC').toUpperCase();
  const asset: 'BTC' | 'ETH' = assetRaw === 'ETH' ? 'ETH' : 'BTC';
  const product = PRODUCT_BY_ASSET[asset];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);

  try {
    const [spot, candles] = await Promise.all([
      fetchSpot(product, ctrl.signal),
      fetchCandles(product, ctrl.signal),
    ]);
    clearTimeout(timer);

    const winStart = fifteenMinAlignedSec();
    const winEnd = winStart + 900;

    // Price to Beat = open of the candle at the 15m-aligned start of the window.
    // If unavailable, fall back to first candle inside the window.
    let priceToBeat: number | null = null;
    const inWindow = candles.filter((c) => c.t >= winStart && c.t < winEnd);
    if (inWindow.length > 0) priceToBeat = inWindow[0].o;
    else if (candles.length > 0) priceToBeat = candles[candles.length - 1].o;

    const live = spot ?? (candles.length > 0 ? candles[candles.length - 1].c : null);

    const change = live != null && priceToBeat != null ? live - priceToBeat : null;
    const changePct = change != null && priceToBeat ? (change / priceToBeat) * 100 : null;

    return NextResponse.json({
      ok: true,
      asset,
      livePrice: live,
      priceToBeat,
      change,
      changePct,
      windowStart: winStart,
      windowEnd: winEnd,
      now: Math.floor(Date.now() / 1000),
      candles,
      source: 'coinbase',
    });
  } catch (err: any) {
    clearTimeout(timer);
    return NextResponse.json(
      { ok: false, asset, error: err?.message || 'fetch failed', candles: [] },
      { status: 500 },
    );
  }
}
