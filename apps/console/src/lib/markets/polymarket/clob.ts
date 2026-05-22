import type { OutcomeBook } from './types';

type RawLevel = { price?: string | number; size?: string | number };
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function normalize(levels: unknown): Array<{ price: number; size: number }> {
  if (!Array.isArray(levels)) return [];
  return levels.map((l) => ({ price: num((l as RawLevel).price), size: num((l as RawLevel).size) })).filter((l) => l.price > 0 && l.size > 0);
}

export async function fetchOrderbook(tokenId: string | null): Promise<OutcomeBook> {
  if (!tokenId) return { bids: [], asks: [], bestBid: null, bestAsk: null, spread: null, bidDepth: 0, askDepth: 0 };
  const res = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!res.ok) return { bids: [], asks: [], bestBid: null, bestAsk: null, spread: null, bidDepth: 0, askDepth: 0 };
  const data = await res.json() as { bids?: unknown; asks?: unknown };
  const bids = normalize(data.bids); const asks = normalize(data.asks);
  const bestBid = bids[0]?.price ?? null; const bestAsk = asks[0]?.price ?? null;
  return { bids, asks, bestBid, bestAsk, spread: bestBid != null && bestAsk != null ? bestAsk - bestBid : null, bidDepth: bids.reduce((a, b) => a + b.size, 0), askDepth: asks.reduce((a, b) => a + b.size, 0) };
}
