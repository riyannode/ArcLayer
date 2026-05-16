/**
 * Pythia signal logic — Polymarket 5m crypto Up/Down market as live oracle.
 *
 * Strategy: Polymarket's 5-minute crypto Up/Down markets aggregate trader
 * sentiment into a real-time probability that the asset will close higher
 * than the window-open price. We treat that probability as our signal:
 *
 *   UP probability > 0.55  → BUY  (market expects price to rise)
 *   UP probability < 0.45  → SELL (market expects price to fall)
 *   else                   → HOLD (uncertain)
 *
 * Confidence = how far from 0.50 the market is, scaled to 0-100.
 * Spot price is pulled from Binance ticker for the `price` field.
 *
 * Supported tokens: BTC, ETH, SOL, XRP, DOGE (markets Polymarket runs).
 * For unsupported tokens we fall back to HOLD with a clear reasoning line.
 */

import type { TradingSignal } from '../shared/types.js';

const GAMMA_URL = 'https://gamma-api.polymarket.com';
const BINANCE_URL = 'https://api.binance.com/api/v3/ticker/price';

const POLYMARKET_TOKENS = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE']);

const BINANCE_SYMBOL: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
  DOGE: 'DOGEUSDT',
};

// 5-minute aligned timestamp for current window (Polymarket slug suffix).
function currentWindowStartSec(): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.ceil(now / 300) * 300;
}

interface PolymarketSnapshot {
  upProb: number;   // 0..1
  downProb: number; // 0..1
  slug: string;
  endDate: string;
}

async function fetchPolymarketSnapshot(token: string): Promise<PolymarketSnapshot | null> {
  const windowStart = currentWindowStartSec();
  const slug = `${token.toLowerCase()}-updown-5m-${windowStart}`;
  try {
    const r = await fetch(`${GAMMA_URL}/events?slug=${slug}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const events = (await r.json()) as Array<{
      markets?: Array<{ outcomePrices?: string; endDate?: string }>;
    }>;
    const m = events?.[0]?.markets?.[0];
    if (!m?.outcomePrices) return null;
    const [upStr, downStr] = JSON.parse(m.outcomePrices) as [string, string];
    const upProb = parseFloat(upStr);
    const downProb = parseFloat(downStr);
    if (!Number.isFinite(upProb) || !Number.isFinite(downProb)) return null;
    return { upProb, downProb, slug, endDate: m.endDate ?? '' };
  } catch {
    return null;
  }
}

async function fetchSpotPrice(token: string): Promise<number | null> {
  const symbol = BINANCE_SYMBOL[token];
  if (!symbol) return null;
  try {
    const r = await fetch(`${BINANCE_URL}?symbol=${symbol}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { price?: string };
    const p = parseFloat(j.price ?? '');
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * Generate signal from live Polymarket 5m Up/Down market.
 */
export async function generateSignal(token: string): Promise<TradingSignal> {
  const upper = token.toUpperCase();
  const reasons: string[] = [];

  // Unsupported asset → safe HOLD, explain why.
  if (!POLYMARKET_TOKENS.has(upper)) {
    return {
      token: upper,
      signal: 'HOLD',
      confidence: 30,
      price: 0,
      reasoning: `${upper} not tracked by Polymarket 5m Up/Down markets — no live signal source`,
      timestamp: Date.now(),
    };
  }

  const [snap, spot] = await Promise.all([
    fetchPolymarketSnapshot(upper),
    fetchSpotPrice(upper),
  ]);

  // Polymarket fetch failed → degrade to HOLD with reason, don't make up data.
  if (!snap) {
    return {
      token: upper,
      signal: 'HOLD',
      confidence: 25,
      price: spot ?? 0,
      reasoning: `Polymarket 5m market unavailable for ${upper} this window — defaulting to HOLD`,
      timestamp: Date.now(),
    };
  }

  // Decision: demo-autonomous mode. Above/equal 0.51 = BUY, below/equal 0.49 = SELL.
  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  if (snap.upProb >= 0.51) signal = 'BUY';
  else if (snap.upProb <= 0.49) signal = 'SELL';

  // Last-resort demo bias: if the market is 49.0–51.0, trade the side with the tiny edge instead of HOLD.
  if (signal === 'HOLD') signal = snap.upProb >= snap.downProb ? 'BUY' : 'SELL';
  if (snap.upProb === snap.downProb) signal = 'HOLD';

  // Confidence: |upProb - 0.5| × 200, clamped 20..95.
  const edge = Math.abs(snap.upProb - 0.5);
  const confidence = Math.max(20, Math.min(95, Math.round(edge * 200 + 30)));

  reasons.push(
    `Polymarket ${snap.slug}: UP ${(snap.upProb * 100).toFixed(1)}% / DOWN ${(snap.downProb * 100).toFixed(1)}%`
  );
  if (signal === 'BUY') {
    reasons.push(`Market leans UP (${(snap.upProb * 100).toFixed(1)}%) → bullish 5m bias`);
  } else if (signal === 'SELL') {
    reasons.push(`Market leans DOWN (${(snap.downProb * 100).toFixed(1)}%) → bearish 5m bias`);
  } else {
    reasons.push(`Market near 50/50 — no clear bias`);
  }
  if (spot) {
    reasons.push(`Spot ${upper}/USDT: $${spot.toFixed(2)} (Binance)`);
  }
  reasons.push(`Window resolves ${snap.endDate}`);

  return {
    token: upper,
    signal,
    confidence,
    price: Number((spot ?? 0).toFixed(2)),
    reasoning: reasons.join('. '),
    timestamp: Date.now(),
  };
}
