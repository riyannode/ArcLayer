import { createHash } from 'node:crypto';
import { fetchCandles1mForWindow } from './candles';
import type { Asset, Candle1m, LiveSnapshot, OutcomeBook } from './types';

const WINDOW_SEC = 900;

type RawLevel = { price?: string | number; size?: string | number };
type MarketFound = {
  asset: Asset;
  marketSlug: string;
  question: string;
  conditionId: string | null;
  windowStart: number;
  windowEnd: number;
  outcomes: LiveSnapshot['outcomes'];
};

type GammaMarket = {
  slug?: string;
  question?: string;
  conditionId?: string;
  outcomePrices?: unknown;
  clobTokenIds?: unknown;
};

function parseMaybeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function alignedWindow(nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const start = now - (now % WINDOW_SEC);
  return { start, end: start + WINDOW_SEC };
}

const emptyBook = (): OutcomeBook => ({ bids: [], asks: [], bestBid: null, bestAsk: null, spread: null, bidDepth: 0, askDepth: 0 });

function normalize(levels: unknown): Array<{ price: number; size: number }> {
  if (!Array.isArray(levels)) return [];
  return levels
    .map((l) => ({ price: Number((l as RawLevel).price), size: Number((l as RawLevel).size) }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.price > 0 && l.size > 0);
}

async function fetchOrderbook(tokenId: string | null): Promise<OutcomeBook> {
  if (!tokenId) return emptyBook();
  const res = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!res.ok) return emptyBook();
  const data = (await res.json()) as { bids?: unknown; asks?: unknown };
  const bids = normalize(data.bids).sort((a, b) => b.price - a.price).slice(0, 20);
  const asks = normalize(data.asks).sort((a, b) => a.price - b.price).slice(0, 20);
  const bestBid = bids.length > 0 ? bids[0].price : null;
  const bestAsk = asks.length > 0 ? asks[0].price : null;
  return {
    bids,
    asks,
    bestBid,
    bestAsk,
    spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
    bidDepth: bids.reduce((acc, x) => acc + x.size, 0),
    askDepth: asks.reduce((acc, x) => acc + x.size, 0),
  };
}

async function fetchActiveUpDownMarket(asset: Asset): Promise<MarketFound | null> {
  const { start } = alignedWindow();
  for (const ws of [start, start - WINDOW_SEC, start - WINDOW_SEC * 2]) {
    const slug = `${asset.toLowerCase()}-updown-15m-${ws}`;
    const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`, { cache: 'no-store', signal: AbortSignal.timeout(9000) });
    if (!res.ok) continue;
    const markets = (await res.json()) as GammaMarket[];
    const market = Array.isArray(markets) ? markets[0] : null;
    if (!market) continue;
    const prices = parseMaybeArray(market.outcomePrices);
    const tokens = parseMaybeArray(market.clobTokenIds);
    return {
      asset,
      marketSlug: market.slug || slug,
      question: market.question || `${asset} Up or Down - 15m`,
      conditionId: market.conditionId || null,
      windowStart: ws,
      windowEnd: ws + WINDOW_SEC,
      outcomes: {
        up: { label: 'UP', probability: Number(prices[0] ?? NaN), tokenId: tokens[0] || null },
        down: { label: 'DOWN', probability: Number(prices[1] ?? NaN), tokenId: tokens[1] || null },
      },
    };
  }
  return null;
}

function pickTargetAndLive(candles: Candle1m[], windowStart: number) {
  if (!candles.length) return { targetPrice: null, livePrice: null, distanceFromTarget: null, directionNow: 'UNKNOWN' as const };
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const startCandle = sorted.find((c) => c.timestamp >= windowStart) ?? sorted.reduce((best, c) => Math.abs(c.timestamp - windowStart) < Math.abs(best.timestamp - windowStart) ? c : best, sorted[0]);
  const latest = sorted[sorted.length - 1];
  const targetPrice = startCandle.open;
  const livePrice = latest.close;
  const distanceFromTarget = livePrice - targetPrice;
  return { targetPrice, livePrice, distanceFromTarget, directionNow: livePrice >= targetPrice ? ('UP' as const) : ('DOWN' as const) };
}

export async function getLiveSnapshot(asset: Asset): Promise<LiveSnapshot | null> {
  const market = await fetchActiveUpDownMarket(asset);
  if (!market) return null;
  const [upBook, downBook, candleResult] = await Promise.all([
    fetchOrderbook(market.outcomes.up.tokenId),
    fetchOrderbook(market.outcomes.down.tokenId),
    fetchCandles1mForWindow(asset, market.windowStart, market.windowEnd),
  ]);
  const candles = candleResult.candles;
  const { targetPrice, livePrice, distanceFromTarget, directionNow } = pickTargetAndLive(candles, market.windowStart);
  const capturedAt = new Date().toISOString();
  const evidence = { market, upBook, downBook, candleTail: candles.slice(-10), capturedAt };
  const rawEvidenceHash = `0x${createHash('sha256').update(JSON.stringify(evidence)).digest('hex')}`;
  return { ...market, targetPrice, livePrice, distanceFromTarget, directionNow, orderbook: { up: upBook, down: downBook }, candles1m: candles, candleError: candleResult.candleError, candleSource: candleResult.candleSource, capturedAt, rawEvidenceHash };
}
