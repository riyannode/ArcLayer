import { createHash, randomUUID } from 'node:crypto';
import type { PriceSample } from './types.js';

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const clamp01 = (value: number) => clamp(value, 0, 1);
export const sideToSignal = (side: 'UP' | 'DOWN' | null): 'BUY' | 'SELL' | 'HOLD' => side === 'UP' ? 'BUY' : side === 'DOWN' ? 'SELL' : 'HOLD';
export const signalToBinary = (side: 'BUY' | 'SELL' | 'HOLD'): 'UP' | 'DOWN' | null => side === 'BUY' ? 'UP' : side === 'SELL' ? 'DOWN' : null;

export function makeSignalId(prefix: string, token: string, now = Date.now()): string {
  try { return `${prefix}_${token}_${randomUUID()}`; } catch {}
  return `${prefix}_${token}_${createHash('sha256').update(`${prefix}:${token}:${now}:${Math.random()}`).digest('hex').slice(0, 16)}`;
}

export function priceAtOrBefore(samples: PriceSample[], tsMs: number): PriceSample | null {
  const sorted = [...samples].sort((a, b) => a.tsMs - b.tsMs);
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].tsMs <= tsMs) return sorted[i];
  return sorted[0] ?? null;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function realizedVol60BpsMin(samples: PriceSample[], nowMs: number): number {
  const scoped = samples.filter((sample) => sample.tsMs >= nowMs - 60_000).sort((a, b) => a.tsMs - b.tsMs);
  if (scoped.length < 3) return 0;
  const returns: number[] = [];
  const intervals: number[] = [];
  for (let i = 1; i < scoped.length; i++) {
    if (scoped[i - 1].price <= 0 || scoped[i].price <= 0) continue;
    returns.push(Math.log(scoped[i].price / scoped[i - 1].price) * 10_000);
    intervals.push(Math.max(0.001, (scoped[i].tsMs - scoped[i - 1].tsMs) / 1000));
  }
  const medianInterval = [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length / 2)] ?? 1;
  return stdev(returns) * Math.sqrt(60 / medianInterval);
}

export function velocityBpsPerSec(samples: PriceSample[], priceNow: number, nowMs: number, lookbackSec: number, sideSign: 1 | -1): number {
  const prior = priceAtOrBefore(samples, nowMs - lookbackSec * 1000)?.price ?? priceNow;
  if (prior <= 0) return 0;
  return sideSign * ((priceNow - prior) / prior) * 10_000 / lookbackSec;
}

export function rangeBps(samples: PriceSample[], openPrice: number, lookbackMs: number, nowMs: number): number {
  const scoped = samples.filter((sample) => sample.tsMs >= nowMs - lookbackMs);
  if (scoped.length < 2 || openPrice <= 0) return 0;
  const prices = scoped.map((sample) => sample.price);
  return ((Math.max(...prices) - Math.min(...prices)) / openPrice) * 10_000;
}

export function wickAgainstPct(samples: PriceSample[], priceNow: number, nowMs: number, side: 'UP' | 'DOWN'): number {
  const scoped = samples.filter((sample) => sample.tsMs >= nowMs - 60_000);
  if (scoped.length === 0) return 0;
  const high = Math.max(...scoped.map((sample) => sample.price), priceNow);
  const low = Math.min(...scoped.map((sample) => sample.price), priceNow);
  const range = Math.max(high - low, 1e-9);
  return side === 'UP' ? clamp01((high - priceNow) / range) : clamp01((priceNow - low) / range);
}

export function countSignFlips(samples: PriceSample[], openPrice: number): number {
  let lastSign = 0;
  let flips = 0;
  for (const sample of [...samples].sort((a, b) => a.tsMs - b.tsMs)) {
    const diff = sample.price - openPrice;
    const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) flips++;
    if (sign !== 0) lastSign = sign;
  }
  return flips;
}

export function countStableTicks(samples: PriceSample[], openPrice: number, side: 'UP' | 'DOWN', maxTicks = 5): number {
  let count = 0;
  for (let i = samples.length - 1; i >= 0 && count < maxTicks; i--) {
    const diff = samples[i].price - openPrice;
    if ((side === 'UP' && diff > 0) || (side === 'DOWN' && diff < 0)) count++;
    else break;
  }
  return count;
}
