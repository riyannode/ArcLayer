import type { ForecastEdgeScore, OracleConfig } from '../types.js';
import { clamp, clamp01 } from '../math.js';

export interface ForecastEdgeInput {
  cfg: OracleConfig;
  forecastProbability: number; // 0..1 external forecast fair probability
  marketProbability: number;   // 0..1 market implied probability
  sigma?: number;              // model disagreement / uncertainty, 0..1 preferred
  timeToCloseSec?: number;
}

/**
 * Weather/forecast strategy distilled into generic forecast-vs-market edge.
 * Useful for event markets, not only weather.
 */
export function evaluateForecastEdge(input: ForecastEdgeInput): ForecastEdgeScore {
  const fp = clamp(input.forecastProbability, 0, 1);
  const mp = clamp(input.marketProbability, 0, 1);
  const rawEdge = fp - mp;
  const absEdgeBps = Math.round(Math.abs(rawEdge) * 10_000);
  const uncertaintyPenalty = clamp01((input.sigma ?? 0.08) / 0.30);
  const lateBoost = input.timeToCloseSec !== undefined && input.timeToCloseSec < 3600 ? 1.10 : 1.0;
  const confidence = clamp(Math.round((absEdgeBps / 80) * (1 - 0.45 * uncertaintyPenalty) * lateBoost), 0, 95);
  const side = absEdgeBps < input.cfg.minForecastEdgeBps ? 'HOLD' : rawEdge > 0 ? 'BUY' : 'SELL';
  const vetoes: string[] = [];
  const warnings: string[] = [];
  if (absEdgeBps < input.cfg.minForecastEdgeBps) vetoes.push('forecast_edge_below_min');
  if (uncertaintyPenalty > 0.70) warnings.push('forecast_sigma_high');
  if (input.timeToCloseSec !== undefined && input.timeToCloseSec < 60) warnings.push('forecast_close_to_resolution');
  return {
    side,
    forecastProbability: fp,
    marketProbability: mp,
    edgeBps: Math.round(rawEdge * 10_000),
    confidence,
    vetoes,
    warnings,
    reason: side === 'HOLD' ? 'forecast edge below threshold' : `forecast ${Math.round(fp * 1000) / 10}% vs market ${Math.round(mp * 1000) / 10}%`,
  };
}
