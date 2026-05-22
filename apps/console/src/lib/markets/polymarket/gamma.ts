import type { Asset, GammaMarket } from './types';

const WINDOW_SEC = 900;

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

export function alignedWindow(nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const start = now - (now % WINDOW_SEC);
  return { start, end: start + WINDOW_SEC };
}

export async function fetchActiveUpDownMarket(asset: Asset) {
  const { start, end } = alignedWindow();
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
      currentWindowStart: start,
      currentWindowEnd: end,
      outcomes: {
        up: { label: 'UP', probability: Number(prices[0] ?? NaN), tokenId: tokens[0] || null },
        down: { label: 'DOWN', probability: Number(prices[1] ?? NaN), tokenId: tokens[1] || null },
      },
    };
  }
  return null;
}
