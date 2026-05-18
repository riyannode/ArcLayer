import type { FullBookSnapshot, MicrostructureReport, MicrostructureSignal, PriceSample } from '../types.js';
import { clamp01 } from '../math.js';
import { depthWithinTicks } from '../book.js';

export interface MicrostructureInput {
  side: 'UP' | 'DOWN';
  intendedBook: FullBookSnapshot;
  oppositeBook: FullBookSnapshot | null;
  previousIntendedBook?: FullBookSnapshot | null;
  samples: PriceSample[];
  openPrice: number;
  priceNow: number;
  thresholdUsd: number;
  elapsedSec: number;
  tickSize: number;
  targetShares: number;
  fillProbability: number;
}

function scoped(samples: PriceSample[], nowMs: number, lookbackMs: number): PriceSample[] {
  return samples.filter((sample) => sample.tsMs >= nowMs - lookbackMs).sort((a, b) => a.tsMs - b.tsMs);
}
function directionalMove(side: 'UP' | 'DOWN', from: number, to: number): number { return side === 'UP' ? to - from : from - to; }
function directionalVelocity(samples: PriceSample[], side: 'UP' | 'DOWN', nowMs: number, lookbackMs: number): number {
  const s = scoped(samples, nowMs, lookbackMs);
  if (s.length < 2) return 0;
  return directionalMove(side, s[0].price, s[s.length - 1].price) / Math.max(1, lookbackMs / 1000);
}
function add(signals: MicrostructureSignal[], name: string, severity: MicrostructureSignal['severity'], scorePenalty: number, reason: string): void {
  signals.push({ name, severity, scorePenalty, reason });
}

export function evaluateMicrostructure(input: MicrostructureInput): MicrostructureReport {
  const nowMs = Date.now();
  const signals: MicrostructureSignal[] = [];
  const book = input.intendedBook;
  const prev = input.previousIntendedBook;
  const spread = book.bestAsk - book.bestBid;
  const previousSpread = prev ? prev.bestAsk - prev.bestBid : spread;
  const bidDepth3 = depthWithinTicks(book.bids, book.bestBid, input.tickSize, 3, 'bid');
  const askDepth3 = depthWithinTicks(book.asks, book.bestAsk, input.tickSize, 3, 'ask');
  const prevBidDepth3 = prev ? depthWithinTicks(prev.bids, prev.bestBid, input.tickSize, 3, 'bid') : bidDepth3;
  const prevAskDepth3 = prev ? depthWithinTicks(prev.asks, prev.bestAsk, input.tickSize, 3, 'ask') : askDepth3;
  const askMoveTicks = prev ? (book.bestAsk - prev.bestAsk) / input.tickSize : 0;
  const bidMoveTicks = prev ? (book.bestBid - prev.bestBid) / input.tickSize : 0;
  const spreadMoveTicks = (spread - previousSpread) / input.tickSize;
  const depthDropPct = (prevBidDepth3 - bidDepth3) / Math.max(prevBidDepth3, 1e-9);
  const askDepthDropPct = (prevAskDepth3 - askDepth3) / Math.max(prevAskDepth3, 1e-9);
  const last30 = scoped(input.samples, nowMs, 30_000);
  const last60 = scoped(input.samples, nowMs, 60_000);
  const v10 = directionalVelocity(input.samples, input.side, nowMs, 10_000);
  const v30 = directionalVelocity(input.samples, input.side, nowMs, 30_000);
  const adverse10 = -v10;
  const edge = Math.max(0, directionalMove(input.side, input.openPrice, input.priceNow));
  const edgeRatio = input.thresholdUsd > 0 ? edge / input.thresholdUsd : 0;

  if (prev && prevBidDepth3 > Math.max(input.targetShares * 2, 20) && depthDropPct > 0.70 && Math.abs(book.bestBid - prev.bestBid) <= input.tickSize) add(signals, 'spoof_like_bid_pull', 'VETO', 18, `bid depth within 3 ticks dropped ${(depthDropPct * 100).toFixed(0)}% without price support`);
  if (prev && askDepthDropPct > 0.65 && askMoveTicks > 0 && input.fillProbability < 0.80) add(signals, 'spoof_like_ask_pull', 'WARN', 8, `ask depth dropped ${(askDepthDropPct * 100).toFixed(0)}% while ask repriced up`);
  if (spread >= 0.05 && askDepth3 < input.targetShares * 1.25 && bidDepth3 < input.targetShares * 0.75) add(signals, 'thin_liquidity_trap', 'VETO', 16, `spread ${spread.toFixed(3)} with shallow top-3 depth`);
  if (edgeRatio >= 1.1 && v30 > 0 && v10 < -0.15 * Math.max(Math.abs(v30), 0.01) && last30.length >= 2) add(signals, 'fake_breakout_reversal', 'VETO', 15, '30s move is positive but 10s directional velocity reversed');
  if (prev && spreadMoveTicks > 1 && Math.abs(askMoveTicks) + Math.abs(bidMoveTicks) >= 1) add(signals, 'spread_expansion', spreadMoveTicks > 3 ? 'VETO' : 'WARN', spreadMoveTicks > 3 ? 12 : 6, `spread widened ${spreadMoveTicks.toFixed(1)} ticks`);
  if (prev && askMoveTicks > 1 && bidMoveTicks <= 0) add(signals, 'aggressive_repricing', askMoveTicks > 3 ? 'VETO' : 'WARN', askMoveTicks > 3 ? 12 : 6, `ask repriced ${askMoveTicks.toFixed(1)} ticks while bid did not follow`);
  if (input.elapsedSec >= 240 && adverse10 > Math.max(input.thresholdUsd / 30, 0.10) && edgeRatio < 1.75) add(signals, 'late_minute_reversal', 'VETO', 16, 'late window adverse velocity with insufficient edge cushion');
  if (prev && bidDepth3 < Math.max(5, input.targetShares * 0.50) && askDepth3 < Math.max(5, input.targetShares * 0.75) && spread > 0.04) add(signals, 'liquidity_vacuum', 'VETO', 14, 'both sides thin with wide spread');
  if (input.oppositeBook) {
    const oppBid3 = depthWithinTicks(input.oppositeBook.bids, input.oppositeBook.bestBid, input.tickSize, 3, 'bid');
    if (oppBid3 > bidDepth3 * 1.75 && edgeRatio < 1.50) add(signals, 'opposite_side_liquidity_dominance', 'WARN', 7, 'opposite side bid support dominates intended side');
  }

  const adverseFillRisk = clamp01(0.35 * (1 - input.fillProbability) + 0.20 * clamp01(spread / 0.08) + 0.15 * clamp01(Math.max(0, askMoveTicks) / 4) + 0.15 * clamp01(Math.max(0, spreadMoveTicks) / 4) + 0.15 * clamp01(Math.max(0, depthDropPct) / 0.70));
  if (adverseFillRisk >= 0.65) add(signals, 'adverse_fill_probability_high', 'VETO', 18, `adverse fill risk ${(adverseFillRisk * 100).toFixed(0)}%`);
  else if (adverseFillRisk >= 0.45) add(signals, 'adverse_fill_probability_elevated', 'WARN', 8, `adverse fill risk ${(adverseFillRisk * 100).toFixed(0)}%`);

  if (last60.length >= 3) {
    const high = Math.max(...last60.map((sample) => sample.price));
    const low = Math.min(...last60.map((sample) => sample.price));
    const rejection = input.side === 'UP' ? (high - input.priceNow) / Math.max(high - low, 1e-9) : (input.priceNow - low) / Math.max(high - low, 1e-9);
    if (rejection > 0.65 && edgeRatio < 1.50) add(signals, 'wick_rejection', 'WARN', 8, `last-60s rejection ${(rejection * 100).toFixed(0)}%`);
  }

  return {
    vetoes: signals.filter((signal) => signal.severity === 'VETO').map((signal) => signal.name),
    warnings: signals.filter((signal) => signal.severity === 'WARN').map((signal) => signal.name),
    scorePenalty: signals.reduce((sum, signal) => sum + signal.scorePenalty, 0),
    signals,
    adverseFillRisk,
  };
}
