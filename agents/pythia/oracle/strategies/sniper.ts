import type { FullBookSnapshot, OracleConfig, PriceSample, SniperScore } from '../types.js';
import { clamp, clamp01, velocityBpsPerSec } from '../math.js';
import { depthWithinTicks } from '../book.js';

export interface SniperInput {
  cfg: OracleConfig;
  openPrice: number;
  priceNow: number;
  samples: PriceSample[];
  elapsedSec: number;
  upBook?: FullBookSnapshot;
  downBook?: FullBookSnapshot;
  tickSize: number;
  marketProbability?: number;
  bookAgeMs?: number;
}

function bookScore(book: FullBookSnapshot | undefined, tickSize: number): { depth: number; spreadScore: number; imbalance: number; vetoes: string[] } {
  if (!book) return { depth: 0, spreadScore: 0, imbalance: 0, vetoes: ['missing_book'] };
  const spread = book.bestAsk - book.bestBid;
  const bidDepth = depthWithinTicks(book.bids, book.bestBid, tickSize, 3, 'bid');
  const askDepth = depthWithinTicks(book.asks, book.bestAsk, tickSize, 3, 'ask');
  const depth = clamp01((bidDepth + askDepth) / 80);
  const spreadScore = 1 - clamp01(spread / 0.06);
  const imbalance = bidDepth / Math.max(bidDepth + askDepth, 1e-9);
  const vetoes: string[] = [];
  if (spread > 0.08) vetoes.push('sniper_spread_too_wide');
  if (bidDepth + askDepth < 12) vetoes.push('sniper_depth_too_thin');
  return { depth, spreadScore, imbalance, vetoes };
}

/**
 * HFT sniper distilled into signal scoring only.
 * No order placement. Intended for Resolver to decide whether to forward.
 */
export function evaluateSniper(input: SniperInput): SniperScore {
  const signed = input.priceNow - input.openPrice;
  const side: 'UP' | 'DOWN' | null = signed > 0 ? 'UP' : signed < 0 ? 'DOWN' : null;
  const vetoes: string[] = [];
  const warnings: string[] = [];
  if (!side) return { active: false, side: null, score: 0, confidence: 0, vetoes: ['no_directional_edge'], warnings, reason: 'no directional edge', components: {} };

  const sideSign: 1 | -1 = side === 'UP' ? 1 : -1;
  const nowMs = Date.now();
  const v10 = velocityBpsPerSec(input.samples, input.priceNow, nowMs, 10, sideSign);
  const v30 = velocityBpsPerSec(input.samples, input.priceNow, nowMs, 30, sideSign);
  const edgeBps = input.openPrice > 0 ? Math.abs(signed / input.openPrice) * 10_000 : 0;
  const timeToClose = 300 - input.elapsedSec;
  const activeWindow = input.elapsedSec >= 45 && timeToClose >= 20;
  if (!activeWindow) warnings.push('outside_preferred_sniper_window');

  const targetBook = side === 'UP' ? input.upBook : input.downBook;
  const oppositeBook = side === 'UP' ? input.downBook : input.upBook;
  const target = bookScore(targetBook, input.tickSize);
  const opposite = bookScore(oppositeBook, input.tickSize);
  vetoes.push(...target.vetoes);
  if ((input.bookAgeMs ?? 0) > 500) vetoes.push('sniper_book_stale_gt_500ms');
  if (v10 < -0.02 || v30 < 0) vetoes.push('sniper_momentum_not_aligned');

  const edgeScore = clamp01((edgeBps - 3) / 12);
  const velocityScore = clamp01((0.65 * v10 + 0.35 * v30) / 0.50);
  const probabilityScore = input.marketProbability === undefined ? 0.5 : side === 'UP' ? input.marketProbability : 1 - input.marketProbability;
  const imbalanceSupport = target.imbalance;
  const oppositeCrowdingPenalty = clamp01(opposite.imbalance - 0.55);

  const components = {
    edgeScore: edgeScore * 25,
    velocityScore: velocityScore * 20,
    probabilityScore: clamp01((probabilityScore - 0.47) / 0.16) * 20,
    depthScore: target.depth * 12,
    spreadScore: target.spreadScore * 10,
    imbalanceScore: clamp01((imbalanceSupport - 0.35) / 0.35) * 8,
    timeScore: activeWindow ? 5 : 1,
    crowdingPenalty: -oppositeCrowdingPenalty * 12,
  };
  const score = clamp(Object.values(components).reduce((a, b) => a + b, 0), 0, 100);
  const confidence = clamp(Math.round(score - vetoes.length * 12), 0, 95);
  const active = score >= input.cfg.minSniperScore && vetoes.length === 0;
  return { active, side, score, confidence, vetoes, warnings, reason: active ? 'sniper momentum, book support, and probability edge aligned' : 'sniper checks not strong enough', components };
}
