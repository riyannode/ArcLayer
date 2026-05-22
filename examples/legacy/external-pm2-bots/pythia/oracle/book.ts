import type { BookLevel } from './types.js';

export function depthWithinTicks(levels: BookLevel[], best: number, tickSize: number, ticks: number, side: 'bid' | 'ask'): number {
  const maxDistance = tickSize * ticks;
  return levels.reduce((sum, level) => {
    const distance = side === 'bid' ? best - level.price : level.price - best;
    return distance >= -1e-9 && distance <= maxDistance + 1e-9 ? sum + level.size : sum;
  }, 0);
}

export function simulateBuyFill(asks: BookLevel[], targetShares: number, maxEntryPrice: number): {
  expectedAvgFill: number;
  fillRatio: number;
  fillableShares: number;
} {
  let remaining = Math.max(0, targetShares);
  let cost = 0;
  let filled = 0;
  const sorted = [...asks].sort((a, b) => a.price - b.price);
  for (const level of sorted) {
    if (level.price > maxEntryPrice || remaining <= 0) break;
    const take = Math.min(remaining, level.size);
    cost += take * level.price;
    filled += take;
    remaining -= take;
  }
  return {
    expectedAvgFill: filled > 0 ? cost / filled : 0,
    fillRatio: targetShares > 0 ? filled / targetShares : 0,
    fillableShares: filled,
  };
}

export function spread(bestAsk: number, bestBid: number): number {
  return Math.max(0, bestAsk - bestBid);
}
