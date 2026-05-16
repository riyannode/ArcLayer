/**
 * Pythia signal logic — momentum + RSI based trading signals.
 * 
 * For demo, we use a deterministic mock that produces realistic signals.
 * In production, swap with real price feed (CoinGecko, Pyth, etc).
 */

import type { TradingSignal } from '../shared/types.js';

interface PriceContext {
  current: number;
  ma5: number;
  ma20: number;
  rsi: number;
  volatility: number;
}

// Mock price store (in-memory, walks like real market)
const priceState = new Map<string, { history: number[]; basePrice: number }>();

function initToken(token: string): void {
  if (priceState.has(token)) return;
  const basePrices: Record<string, number> = {
    BTC: 95000,
    ETH: 3500,
    SOL: 180,
    USDC: 1,
  };
  const base = basePrices[token] ?? 100;
  // Seed with 50 historical candles using random walk
  const history: number[] = [base];
  for (let i = 1; i < 50; i++) {
    const drift = (Math.random() - 0.48) * 0.02; // slight upward bias
    history.push(history[i - 1] * (1 + drift));
  }
  priceState.set(token, { history, basePrice: base });
}

function tickPrice(token: string): PriceContext {
  initToken(token);
  const state = priceState.get(token)!;
  const last = state.history[state.history.length - 1];
  const drift = (Math.random() - 0.49) * 0.015;
  const next = last * (1 + drift);
  state.history.push(next);
  if (state.history.length > 100) state.history.shift();

  const ma5 = avg(state.history.slice(-5));
  const ma20 = avg(state.history.slice(-20));
  const rsi = calcRSI(state.history.slice(-15));
  const volatility = stdDev(state.history.slice(-20)) / next;

  return { current: next, ma5, ma20, rsi, volatility };
}

function avg(arr: number[]): number {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  const m = avg(arr);
  const v = avg(arr.map(x => (x - m) ** 2));
  return Math.sqrt(v);
}

function calcRSI(prices: number[]): number {
  if (prices.length < 2) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/**
 * Generate signal from price context.
 * Strategy: MA crossover + RSI confirmation
 */
export function generateSignal(token: string): TradingSignal {
  const ctx = tickPrice(token);
  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 50;
  const reasons: string[] = [];

  // MA crossover
  if (ctx.ma5 > ctx.ma20 * 1.005) {
    signal = 'BUY';
    confidence += 15;
    reasons.push(`MA5 (${ctx.ma5.toFixed(2)}) above MA20 (${ctx.ma20.toFixed(2)}) — bullish trend`);
  } else if (ctx.ma5 < ctx.ma20 * 0.995) {
    signal = 'SELL';
    confidence += 15;
    reasons.push(`MA5 (${ctx.ma5.toFixed(2)}) below MA20 (${ctx.ma20.toFixed(2)}) — bearish trend`);
  } else {
    reasons.push(`MA5/MA20 in equilibrium — no clear trend`);
  }

  // RSI confirmation
  if (ctx.rsi > 70) {
    if (signal === 'BUY') confidence -= 20;
    if (signal === 'HOLD') { signal = 'SELL'; confidence += 10; }
    reasons.push(`RSI ${ctx.rsi.toFixed(1)} — overbought zone`);
  } else if (ctx.rsi < 30) {
    if (signal === 'SELL') confidence -= 20;
    if (signal === 'HOLD') { signal = 'BUY'; confidence += 10; }
    reasons.push(`RSI ${ctx.rsi.toFixed(1)} — oversold zone`);
  } else {
    reasons.push(`RSI ${ctx.rsi.toFixed(1)} — neutral`);
  }

  // Volatility penalty
  if (ctx.volatility > 0.03) {
    confidence -= 10;
    reasons.push(`High volatility (${(ctx.volatility * 100).toFixed(2)}%) — reduce confidence`);
  }

  confidence = Math.max(20, Math.min(95, confidence));

  return {
    token,
    signal,
    confidence,
    price: Number(ctx.current.toFixed(2)),
    reasoning: reasons.join('. '),
    timestamp: Date.now(),
  };
}
