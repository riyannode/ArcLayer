/**
 * ArcLayer Resolver Types
 *
 * Paid public layer. Resolver consumes raw Oracle signals and sells final decisions.
 */
export type SignalSide = 'BUY' | 'SELL' | 'HOLD';
export type SignalKind =
  | 'POLYMARKET_PROBABILITY'
  | 'MOMENTUM_REGIME'
  | 'ENTRY_QUALITY'
  | 'MICROSTRUCTURE'
  | 'SNIPER'
  | 'FORECAST_EDGE'
  | 'SYNTHETIC_ARBITRAGE';
export type ResolverStatus = 'APPROVED' | 'DOWNGRADED' | 'REJECTED' | 'EXIT_WARNING';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
export type ActionHint = 'forward_signal' | 'hold' | 'reduce_or_close' | 'do_not_use';

export interface RawOracleSignal {
  signalId: string;
  producer: string;
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
  regime?: 'TREND' | 'BREAKOUT' | 'SIDEWAY' | 'FAKEOUT_RISK';
  vetoes: string[];
  warnings: string[];
  evidence: Record<string, unknown>;
  reasoning: string;
  generatedAt: number;
  expiresAt: number;
}

export interface ResolvedSignalDecision {
  decisionId: string;
  resolver: 'ARCLAYER_RESOLVER';
  token: string;
  finalSignal: SignalSide;
  status: ResolverStatus;
  confidence: number;
  riskLevel: RiskLevel;
  actionHint: ActionHint;
  price: number;
  reasons: string[];
  vetoes: string[];
  warnings: string[];
  sourceSignals: RawOracleSignal[];
  generatedAt: number;
  expiresAt: number;
  payment?: {
    amount: string;
    asset: 'USDC';
    network: string;
    txHash?: string | null;
    payer?: string | null;
  };
}

export interface ResolverPolicy {
  minApprovedConfidence: number;
  minForwardScoreGap: number;
  maxSignalAgeMs: number;
  rejectVetoes: Set<string>;
  downgradeVetoes: Set<string>;
  kindWeights: Record<SignalKind, number>;
  blockOnConflict: boolean;
  allowSyntheticArbAsBuy: boolean;
}

export interface ResolverInput {
  token: string;
  rawSignals: RawOracleSignal[];
  nowMs?: number;
  previousDecision?: ResolvedSignalDecision | null;
}

export interface TradingSignalCompat {
  token: string;
  signal: SignalSide;
  confidence: number;
  price: number;
  reasoning: string;
  timestamp: number;
}
