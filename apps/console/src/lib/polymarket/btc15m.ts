import { createHash } from 'node:crypto';

export const runtime = 'nodejs';

const ASSET = 'BTC';
const TIMEFRAME = '15m';
const WINDOW_SEC = 900;

export type PolymarketMarket = {
  slug: string;
  question?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  conditionId?: string;
  volume?: string | number;
};

function hash(payload: unknown) {
  return `0x${createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex')}`;
}

function parseArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toNum(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function alignedWindow(nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const start = now - (now % WINDOW_SEC);
  return { start, end: start + WINDOW_SEC };
}

export async function fetchBtc15mMarket() {
  const { start, end } = alignedWindow();
  const candidates = [start, start - WINDOW_SEC, start - WINDOW_SEC * 2];

  for (const ws of candidates) {
    const slug = `btc-updown-15m-${ws}`;
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const markets = (await res.json()) as PolymarketMarket[];
      const market = Array.isArray(markets) ? markets[0] : null;
      if (!market) continue;
      const [upRaw, downRaw] = parseArray(market.outcomePrices);
      const [upTokenId, downTokenId] = parseArray(market.clobTokenIds);
      const upPrice = toNum(upRaw, 0.5);
      const downPrice = toNum(downRaw, 0.5);
      const payload = {
        ok: true,
        source: 'polymarket',
        asset: ASSET,
        timeframe: TIMEFRAME,
        marketSlug: market.slug || slug,
        question: market.question || 'Bitcoin Up or Down - 15m',
        upPrice,
        downPrice,
        spread: Math.abs(upPrice - downPrice),
        volume: market.volume != null ? toNum(market.volume, 0) : null,
        conditionId: market.conditionId || null,
        tokenIds: { up: upTokenId || null, down: downTokenId || null },
        windowStart: ws,
        windowEnd: ws + WINDOW_SEC,
        currentWindowStart: start,
        currentWindowEnd: end,
        fetchedAt: new Date().toISOString(),
      };
      return { ...payload, payloadHash: hash(payload) };
    } catch {
      // Try previous window; Polymarket can lag the fresh 15m slug.
    }
  }

  const fallback = {
    ok: false,
    source: 'polymarket',
    asset: ASSET,
    timeframe: TIMEFRAME,
    error: 'no_active_btc_15m_market_found',
    fetchedAt: new Date().toISOString(),
  };
  return { ...fallback, payloadHash: hash(fallback) };
}

export async function fetchOrderbook(tokenId: string) {
  const [bookRes, midRes] = await Promise.allSettled([
    fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) }),
    fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) }),
  ]);

  let book: { bids?: unknown[]; asks?: unknown[] } = { bids: [], asks: [] };
  if (bookRes.status === 'fulfilled' && bookRes.value.ok) {
    book = await bookRes.value.json();
  }

  let mid: number | null = null;
  if (midRes.status === 'fulfilled' && midRes.value.ok) {
    const data = await midRes.value.json();
    mid = data?.mid != null ? toNum(data.mid, 0) : null;
  }

  return {
    bids: Array.isArray(book.bids) ? book.bids : [],
    asks: Array.isArray(book.asks) ? book.asks : [],
    mid,
  };
}

export async function fetchPriceHistory(marketId: string, interval = '1h', fidelity = '72') {
  const url = `https://clob.polymarket.com/prices-history?market=${marketId}&interval=${interval}&fidelity=${fidelity}`;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.history) ? data.history : [];
}

export function payloadHash(payload: unknown) {
  return hash(payload);
}
