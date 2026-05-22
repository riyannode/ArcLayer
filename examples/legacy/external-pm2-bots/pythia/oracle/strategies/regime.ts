import type { PriceSample, RegimeSnapshot, OracleConfig } from '../types.js';
import { countSignFlips, countStableTicks, priceAtOrBefore, rangeBps } from '../math.js';

const FIVE_MIN_MS = 300_000;

export function classifyRegime(
  samples: PriceSample[],
  openPrice: number,
  priceNow: number,
  thresholdUsd: number,
  cfg: Pick<OracleConfig, 'momentumMaxRetracement' | 'signalMaxFlipCount'>,
  nowMs = Date.now(),
): RegimeSnapshot {
  const signedEdge = priceNow - openPrice;
  const side: 'UP' | 'DOWN' = signedEdge >= 0 ? 'UP' : 'DOWN';
  const edge = Math.abs(signedEdge);
  const directionalEdges = samples.map((sample) => side === 'UP' ? sample.price - openPrice : openPrice - sample.price);
  const peakEdge = Math.max(edge, ...directionalEdges.filter(Number.isFinite), 0);
  const retracementPct = peakEdge > 0 ? Math.max(0, Math.min(1, (peakEdge - edge) / peakEdge)) : 0;

  const p15 = priceAtOrBefore(samples, nowMs - 15_000)?.price ?? openPrice;
  const p30 = priceAtOrBefore(samples, nowMs - 30_000)?.price ?? openPrice;
  const p90 = priceAtOrBefore(samples, nowMs - 90_000)?.price ?? openPrice;
  const slope15 = priceNow - p15;
  const slope30 = priceNow - p30;
  const slope90 = priceNow - p90;
  const signFlipCount = countSignFlips(samples, openPrice);
  const stableTicks = countStableTicks(samples, openPrice, side);
  const rangeBps60 = rangeBps(samples, openPrice, 60_000, nowMs);
  const rangeBpsWindow = rangeBps(samples, openPrice, FIVE_MIN_MS, nowMs);
  const slope30Ok = side === 'UP' ? slope30 >= 0 : slope30 <= 0;
  const slope90Ok = side === 'UP' ? slope90 >= -thresholdUsd * 0.25 : slope90 <= thresholdUsd * 0.25;
  const edgeRatio = thresholdUsd > 0 ? edge / thresholdUsd : 0;

  let regime: RegimeSnapshot['regime'] = 'TREND';
  let reason = 'trend_confirmed';
  if (retracementPct >= 0.55 || (signFlipCount >= cfg.signalMaxFlipCount && !slope30Ok)) {
    regime = 'FAKEOUT_RISK';
    reason = 'retracement_or_flip_risk';
  } else if (edgeRatio >= 2.2 && slope30Ok && slope90Ok && retracementPct <= 0.30) {
    regime = 'BREAKOUT';
    reason = 'strong_breakout';
  } else if (signFlipCount >= 2 || edgeRatio < 1.1 || rangeBps60 < 3.5) {
    regime = 'SIDEWAY';
    reason = 'choppy_or_low_edge';
  }

  const confidenceParts = [
    Math.min(30, edgeRatio * 12),
    slope30Ok ? 20 : -15,
    slope90Ok ? 15 : -10,
    Math.max(-25, 20 - retracementPct * 50),
    Math.max(-20, 15 - signFlipCount * 5),
  ];
  const confidence = Math.max(0, Math.min(100, confidenceParts.reduce((sum, part) => sum + part, 20)));

  return { regime, side, edge, signedEdge, peakEdge, retracementPct, slope15, slope30, slope90, signFlipCount, stableTicks, rangeBps60, rangeBpsWindow, confidence, reason };
}

export function isMomentumValid(signal: RegimeSnapshot, cfg: Pick<OracleConfig, 'momentumMaxRetracement' | 'signalMaxFlipCount' | 'momentumMinStableTicks'>, thresholdUsd: number): { ok: boolean; reason: string } {
  if (signal.edge < thresholdUsd) return { ok: false, reason: `edge ${signal.edge.toFixed(2)} < threshold ${thresholdUsd.toFixed(2)}` };
  if (signal.regime === 'FAKEOUT_RISK') return { ok: false, reason: `fakeout risk: ${signal.reason}` };
  const slopeAligned = signal.side === 'UP'
    ? signal.slope30 >= 0 && signal.slope90 >= -signal.edge * 0.25
    : signal.slope30 <= 0 && signal.slope90 <= signal.edge * 0.25;
  if (!slopeAligned) return { ok: false, reason: 'slope not aligned' };
  if (signal.retracementPct > cfg.momentumMaxRetracement) return { ok: false, reason: `retracement ${(signal.retracementPct * 100).toFixed(1)}% too high` };
  if (signal.stableTicks < cfg.momentumMinStableTicks) return { ok: false, reason: `stable ticks ${signal.stableTicks} too low` };
  if (signal.signFlipCount > cfg.signalMaxFlipCount) return { ok: false, reason: `sign flips ${signal.signFlipCount} too high` };
  return { ok: true, reason: 'momentum confirmed' };
}
