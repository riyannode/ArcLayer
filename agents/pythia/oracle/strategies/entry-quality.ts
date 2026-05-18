import type { EntryQualityScore, FullBookSnapshot, OracleConfig, PriceSample, RegimeSnapshot } from '../types.js';
import { clamp, clamp01, realizedVol60BpsMin, velocityBpsPerSec, wickAgainstPct } from '../math.js';
import { depthWithinTicks, simulateBuyFill } from '../book.js';

export interface EntryQualityInput {
  cfg: OracleConfig;
  side: 'UP' | 'DOWN';
  entryMode: 'momentum' | 'sideway_micro_scalp';
  signal: RegimeSnapshot;
  samples: PriceSample[];
  openPrice: number;
  priceNow: number;
  thresholdUsd: number;
  elapsedSec: number;
  intendedBook: FullBookSnapshot;
  oppositeBook: FullBookSnapshot | null;
  targetShares: number;
  maxEntryPrice: number;
  tickSize: number;
  bookAgeMs: number;
  priceAgeMs: number;
  scoredAtMs?: number;
  previousIntendedBook?: FullBookSnapshot | null;
}

function volatilityScore(rv60: number): number {
  if (rv60 < 1.5) return 0.20;
  if (rv60 < 4.0) return 0.20 + ((rv60 - 1.5) / 2.5) * 0.80;
  if (rv60 <= 18.0) return 1.00;
  if (rv60 <= 35.0) return 1.00 - ((rv60 - 18.0) / 17.0) * 0.80;
  return 0;
}

function timeScore(elapsedSec: number, entryMode: 'momentum' | 'sideway_micro_scalp', cfg: OracleConfig): number {
  const timeToExpirySec = 300 - elapsedSec;
  if (entryMode === 'sideway_micro_scalp') {
    if (elapsedSec < cfg.sidewayMinSecond || elapsedSec > cfg.sidewayMaxSecond) return 0;
    return 1;
  }
  if (timeToExpirySec < 45) return 0;
  if (timeToExpirySec < 90) return 0.40 + ((timeToExpirySec - 45) / 45) * 0.60;
  if (timeToExpirySec <= 210) return 1;
  return 0.60;
}

function requiredScoreFor(regime: RegimeSnapshot['regime'], entryMode: 'momentum' | 'sideway_micro_scalp'): number {
  if (entryMode === 'sideway_micro_scalp' || regime === 'SIDEWAY') return 78;
  if (regime === 'BREAKOUT') return 76;
  if (regime === 'FAKEOUT_RISK') return 101;
  return 70;
}

function scoreStakeMultiplier(score: number, requiredScore: number): number {
  if (score < requiredScore) return 0;
  if (score < 75) return 0.35;
  if (score < 82) return 0.60;
  if (score < 89) return 1.00;
  return 1.15;
}

export function evaluateEntryQuality(input: EntryQualityInput): EntryQualityScore {
  const nowMs = input.scoredAtMs ?? Date.now();
  const { cfg, side, signal, samples, openPrice, priceNow, thresholdUsd, intendedBook, oppositeBook, targetShares, maxEntryPrice, tickSize } = input;
  const sideSign: 1 | -1 = side === 'UP' ? 1 : -1;
  const thresholdBps = openPrice > 0 ? thresholdUsd / openPrice * 10_000 : 0;
  const edgeUsdSigned = sideSign * (priceNow - openPrice);
  const edgeUsd = Math.max(0, edgeUsdSigned);
  const edgeRatio = thresholdUsd > 0 ? edgeUsd / thresholdUsd : 0;
  const edgeScore = clamp01((edgeRatio - 0.85) / (1.80 - 0.85));

  const v15 = velocityBpsPerSec(samples, priceNow, nowMs, 15, sideSign);
  const v30 = velocityBpsPerSec(samples, priceNow, nowMs, 30, sideSign);
  const v60 = velocityBpsPerSec(samples, priceNow, nowMs, 60, sideSign);
  const vReq = thresholdBps / Math.max(input.elapsedSec, 30);
  const velocityRatio = v30 / Math.max(vReq, 0.015);
  const velocityScore = clamp01((velocityRatio - 0.60) / (1.80 - 0.60));
  const accelNorm = (v15 - v60) / Math.max(Math.abs(v60), vReq, 0.015);
  const accelScore = clamp01((accelNorm + 0.30) / 1.20);
  const rv60 = realizedVol60BpsMin(samples, nowMs);
  const volScore = volatilityScore(rv60);
  const retracementScore = 1 - clamp01(signal.retracementPct / cfg.momentumMaxRetracement);
  const flipScore = 1 - clamp01(signal.signFlipCount / Math.max(cfg.signalMaxFlipCount, 1));
  const wickPct = wickAgainstPct(samples, priceNow, nowMs, side);
  const wickScore = 1 - clamp01((wickPct - 0.25) / (0.55 - 0.25));

  const trendTerm = Math.tanh((edgeRatio - 1.00) * 1.25);
  const velocityTerm = Math.tanh((velocityRatio - 1.00) * 0.90);
  const accelTerm = Math.tanh(accelNorm * 0.75);
  const volPenalty = 1 - volScore;
  const fakeoutPenalty = Math.max(signal.retracementPct / cfg.momentumMaxRetracement, signal.signFlipCount / Math.max(cfg.signalMaxFlipCount, 1), wickPct);
  const fairProb = clamp(0.50 + 0.18 * trendTerm + 0.08 * velocityTerm + 0.04 * accelTerm - 0.08 * volPenalty - 0.10 * fakeoutPenalty, 0.50, 0.93);
  const costPerShare = intendedBook.bestAsk;
  const lag = fairProb - costPerShare;
  const lagScore = clamp01((lag - 0.015) / (0.080 - 0.015));

  const spread = intendedBook.bestAsk - intendedBook.bestBid;
  const allowedSpread = input.entryMode === 'sideway_micro_scalp' ? cfg.sidewayMaxSpread : cfg.maxSpread;
  const spreadScore = 1 - clamp01(spread / Math.max(allowedSpread, 0.001));
  const fill = simulateBuyFill(intendedBook.asks, targetShares, maxEntryPrice);
  const vwapScore = fill.expectedAvgFill > 0 ? 1 - clamp01((fill.expectedAvgFill - intendedBook.bestAsk) / Math.max(cfg.slippageBuffer, 0.001)) : 0;
  const depthScore = 0.65 * fill.fillRatio + 0.35 * vwapScore;

  const ask1sAgo = input.previousIntendedBook?.bestAsk ?? intendedBook.bestAsk;
  const spread1sAgo = input.previousIntendedBook ? input.previousIntendedBook.bestAsk - input.previousIntendedBook.bestBid : spread;
  const askMoveTicks1s = Math.max(0, (intendedBook.bestAsk - ask1sAgo) / tickSize);
  const spreadMoveTicks1s = Math.max(0, (spread - spread1sAgo) / tickSize);
  const bookAgePenalty = clamp01(input.bookAgeMs / 500);
  const fillProbability = clamp01(fill.fillRatio * Math.exp(-0.18 * askMoveTicks1s) * Math.exp(-0.12 * spreadMoveTicks1s) * (1 - 0.50 * bookAgePenalty));

  const intendedBidDepth3 = depthWithinTicks(intendedBook.bids, intendedBook.bestBid, tickSize, 3, 'bid');
  const intendedAskDepth3 = depthWithinTicks(intendedBook.asks, intendedBook.bestAsk, tickSize, 3, 'ask');
  const oppositeBidDepth3 = oppositeBook ? depthWithinTicks(oppositeBook.bids, oppositeBook.bestBid, tickSize, 3, 'bid') : 0;
  const supportRatio = intendedBidDepth3 / Math.max(intendedBidDepth3 + intendedAskDepth3, 1e-9);
  const oppositionRatio = oppositeBidDepth3 / Math.max(oppositeBidDepth3 + intendedBidDepth3, 1e-9);
  const imbalanceScore = clamp01((supportRatio - 0.35) / (0.65 - 0.35));
  const oppositeLiquidityScore = oppositeBook ? 1 - clamp01((oppositionRatio - 0.45) / (0.75 - 0.45)) : 0;

  const bidDepth3Previous = input.previousIntendedBook ? depthWithinTicks(input.previousIntendedBook.bids, input.previousIntendedBook.bestBid, tickSize, 3, 'bid') : intendedBidDepth3;
  const depthDropPct = (bidDepth3Previous - intendedBidDepth3) / Math.max(bidDepth3Previous, 1e-9);
  const liqDeterioration = Math.max(clamp01(depthDropPct / 0.60), clamp01(askMoveTicks1s / 4), clamp01(spreadMoveTicks1s / 4));
  const liquidityScore = 1 - liqDeterioration;
  const tScore = timeScore(input.elapsedSec, input.entryMode, cfg);

  const breakdown = {
    edgeScore: 8 * edgeScore,
    velocityScore: 8 * velocityScore,
    accelScore: 6 * accelScore,
    volatilityScore: 7 * volScore,
    retracementScore: 7 * retracementScore,
    flipScore: 5 * flipScore,
    wickScore: 7 * wickScore,
    lagScore: 12 * lagScore,
    spreadScore: 6 * spreadScore,
    depthScore: 8 * depthScore,
    imbalanceScore: 6 * imbalanceScore,
    oppositeLiquidityScore: 5 * oppositeLiquidityScore,
    liquidityScore: 6 * liquidityScore,
    fillProbability: 7 * fillProbability,
    timeToExpiry: 5 * tScore,
  };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const requiredScore = requiredScoreFor(signal.regime, input.entryMode);
  const vetoes: string[] = [];
  const warnings: string[] = [];

  if (signal.regime === 'FAKEOUT_RISK') vetoes.push('regime_fakeout_risk');
  if (signal.retracementPct > cfg.momentumMaxRetracement) vetoes.push('retracement_gt_max');
  if (signal.signFlipCount > cfg.signalMaxFlipCount) vetoes.push('sign_flips_gt_max');
  if (lag < 0.005) vetoes.push('lag_below_min');
  if (input.bookAgeMs > 500) vetoes.push('book_stale_gt_500ms');
  if (input.priceAgeMs > 750) vetoes.push('price_stale_gt_750ms');
  if (fillProbability < 0.65) vetoes.push('fill_probability_lt_065');
  if (spread > allowedSpread) vetoes.push('spread_gt_allowed');
  if (fill.fillableShares < cfg.minSellableShares) vetoes.push('fillable_shares_below_min_sellable');
  if (fill.fillRatio < 0.70) vetoes.push('fill_ratio_lt_070');
  if (fill.expectedAvgFill > maxEntryPrice) vetoes.push('expected_avg_fill_gt_max_entry');
  if (300 - input.elapsedSec < 35) vetoes.push('time_to_expiry_lt_35s');
  if (!oppositeBook) warnings.push('missing_opposite_book');
  if (rv60 > 45 && spread > 0.04) vetoes.push('volatility_shock_wide_spread');
  if (wickPct > 0.60 && input.elapsedSec > 120) warnings.push('wick_rejection_gt_060');
  if (v15 < -0.25 * Math.max(Math.abs(v60), vReq)) vetoes.push('velocity_reversal');
  if (oppositionRatio > 0.80 && edgeRatio < 1.50) warnings.push('opposite_liquidity_dominant');
  if (liqDeterioration > 0.75) vetoes.push('liquidity_deterioration_gt_075');

  let stakeMultiplierHint = scoreStakeMultiplier(score, requiredScore);
  if (input.entryMode === 'sideway_micro_scalp') stakeMultiplierHint = Math.min(stakeMultiplierHint, cfg.sidewayStakeMultiplier);
  if (spread > 0.04 || rv60 > 25 || fillProbability < 0.75) stakeMultiplierHint = Math.min(stakeMultiplierHint, 0.50);

  return { score, requiredScore, passed: score >= requiredScore && vetoes.length === 0, stakeMultiplierHint, vetoes, warnings, breakdown, expectedAvgFill: fill.expectedAvgFill, fillProbability, lag };
}
