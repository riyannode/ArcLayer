/**
 * ArcLayer Oracle Types
 *
 * Pure raw-signal layer. No payment, no order placement, no execution.
 * Resolver is the paid public target. Oracle only emits evidence-rich signals.
 */

export type SignalSide = 'BUY' | 'SELL' | 'HOLD';
export type BinarySide = 'UP' | 'DOWN';
export type Regime = 'TREND' | 'BREAKOUT' | 'SIDEWAY' | 'FAKEOUT_RISK';

export type SignalKind =
  | 'POLYMARKET_PROBABILITY'
  | 'MOMENTUM_REGIME'
  | 'ENTRY_QUALITY'
  | 'MICROSTRUCTURE'
  | 'SNIPER'
  | 'FORECAST_EDGE'
  | 'SYNTHETIC_ARBITRAGE';

export interface PriceSample {
  tsMs: number;
  price: number;
}

export interface BookLevel {
  price: number;
  size: number;
}

export interface FullBookSnapshot {
  bestBid: number;
  bestAsk: number;
  bids: BookLevel[];
  asks: BookLevel[];
  tsMs?: number;
}

export interface DualOutcomeBook {
  marketId: string;
  up: FullBookSnapshot & { tokenId?: string };
  down: FullBookSnapshot & { tokenId?: string };
  observedAtMs?: number;
}

export interface RegimeSnapshot {
  regime: Regime;
  side: BinarySide;
  edge: number;
  signedEdge: number;
  peakEdge: number;
  retracementPct: number;
  slope15: number;
  slope30: number;
  slope90: number;
  signFlipCount: number;
  stableTicks: number;
  rangeBps60: number;
  rangeBpsWindow: number;
  confidence: number;
  reason: string;
}

export interface EntryQualityScore {
  score: number;
  requiredScore: number;
  passed: boolean;
  stakeMultiplierHint: number;
  vetoes: string[];
  warnings: string[];
  breakdown: Record<string, number>;
  expectedAvgFill: number;
  fillProbability: number;
  lag: number;
}

export interface MicrostructureSignal {
  name: string;
  severity: 'INFO' | 'WARN' | 'VETO';
  scorePenalty: number;
  reason: string;
}

export interface MicrostructureReport {
  vetoes: string[];
  warnings: string[];
  scorePenalty: number;
  signals: MicrostructureSignal[];
  adverseFillRisk: number;
}

export interface SniperScore {
  active: boolean;
  side: BinarySide | null;
  score: number;
  confidence: number;
  vetoes: string[];
  warnings: string[];
  reason: string;
  components: Record<string, number>;
}

export interface ForecastEdgeScore {
  side: SignalSide;
  forecastProbability: number;
  marketProbability: number;
  edgeBps: number;
  confidence: number;
  vetoes: string[];
  warnings: string[];
  reason: string;
}

export interface SyntheticArbSignal {
  active: boolean;
  grossEdgeBps: number;
  estimatedCostBps: number;
  netEdgeBps: number;
  confidence: number;
  tradeQuality: number;
  vetoes: string[];
  warnings: string[];
  reason: string;
  legs: Array<{ outcome: BinarySide; tokenId?: string; price: number; size: number }>;
}

export interface RawOracleSignal {
  signalId: string;
  producer: 'PYTHIA_ORACLE';
  token: string;
  side: SignalSide;
  kind: SignalKind;
  confidence: number;
  price: number;
  fairProbability?: number;
  marketProbability?: number;
  edgeBps?: number;
  netEdgeBps?: number;
  qualityScore?: number;
  stakeMultiplierHint?: number;
  regime?: Regime;
  vetoes: string[];
  warnings: string[];
  evidence: Record<string, unknown>;
  reasoning: string;
  generatedAt: number;
  expiresAt: number;
}

export interface OracleInput {
  token: string;
  spotPrice: number;
  openPrice?: number;
  thresholdUsd?: number;
  elapsedSec?: number;
  samples?: PriceSample[];
  intendedBook?: FullBookSnapshot;
  oppositeBook?: FullBookSnapshot | null;
  previousIntendedBook?: FullBookSnapshot | null;
  dualOutcomeBook?: DualOutcomeBook;
  marketProbability?: number;
  forecastProbability?: number;
  forecastSigma?: number;
  timeToCloseSec?: number;
  targetShares?: number;
  maxEntryPrice?: number;
  tickSize?: number;
  bookAgeMs?: number;
  priceAgeMs?: number;
  observedAtMs?: number;
}

export interface OracleConfig {
  ttlMs: number;
  momentumMaxRetracement: number;
  signalMaxFlipCount: number;
  momentumMinStableTicks: number;
  minQualityScore: number;
  maxSpread: number;
  slippageBuffer: number;
  minSellableShares: number;
  sidewayMinSecond: number;
  sidewayMaxSecond: number;
  sidewayMaxSpread: number;
  sidewayStakeMultiplier: number;
  minSniperScore: number;
  minForecastEdgeBps: number;
  minSyntheticNetEdgeBps: number;
  estimatedSyntheticCostBps: number;
}

export const DEFAULT_ORACLE_CONFIG: OracleConfig = {
  ttlMs: 20_000,
  momentumMaxRetracement: 0.45,
  signalMaxFlipCount: 3,
  momentumMinStableTicks: 2,
  minQualityScore: 70,
  maxSpread: 0.05,
  slippageBuffer: 0.025,
  minSellableShares: 5,
  sidewayMinSecond: 120,
  sidewayMaxSecond: 250,
  sidewayMaxSpread: 0.035,
  sidewayStakeMultiplier: 0.5,
  minSniperScore: 68,
  minForecastEdgeBps: 250,
  minSyntheticNetEdgeBps: 120,
  estimatedSyntheticCostBps: 35,
};
