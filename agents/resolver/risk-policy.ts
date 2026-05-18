import type { ResolverPolicy, SignalKind } from './types.js';

export const DEFAULT_RESOLVER_POLICY: ResolverPolicy = {
  minApprovedConfidence: 62,
  minForwardScoreGap: 12,
  maxSignalAgeMs: 30_000,
  rejectVetoes: new Set([
    'regime_fakeout_risk',
    'book_stale_gt_500ms',
    'price_stale_gt_750ms',
    'fill_probability_lt_065',
    'spread_gt_allowed',
    'thin_liquidity_trap',
    'fake_breakout_reversal',
    'late_minute_reversal',
    'liquidity_vacuum',
    'adverse_fill_probability_high',
    'sniper_book_stale_gt_500ms',
    'sniper_momentum_not_aligned',
    'synthetic_book_instability_high',
  ]),
  downgradeVetoes: new Set([
    'probability_near_50_50',
    'forecast_edge_below_min',
    'synthetic_net_edge_below_min',
    'insufficient_oracle_inputs',
    'lag_below_min',
    'fill_ratio_lt_070',
    'expected_avg_fill_gt_max_entry',
  ]),
  kindWeights: {
    POLYMARKET_PROBABILITY: 0.75,
    MOMENTUM_REGIME: 0.90,
    ENTRY_QUALITY: 1.30,
    MICROSTRUCTURE: 1.15,
    SNIPER: 1.05,
    FORECAST_EDGE: 1.00,
    SYNTHETIC_ARBITRAGE: 0.85,
  } satisfies Record<SignalKind, number>,
  blockOnConflict: true,
  allowSyntheticArbAsBuy: false,
};

export function mergePolicy(partial?: Partial<ResolverPolicy>): ResolverPolicy {
  if (!partial) return DEFAULT_RESOLVER_POLICY;
  return {
    ...DEFAULT_RESOLVER_POLICY,
    ...partial,
    rejectVetoes: partial.rejectVetoes ?? DEFAULT_RESOLVER_POLICY.rejectVetoes,
    downgradeVetoes: partial.downgradeVetoes ?? DEFAULT_RESOLVER_POLICY.downgradeVetoes,
    kindWeights: { ...DEFAULT_RESOLVER_POLICY.kindWeights, ...(partial.kindWeights ?? {}) },
  };
}
