import type { OracleConfig, OracleInput, RawOracleSignal } from './types.js';
import { DEFAULT_ORACLE_CONFIG } from './types.js';
import { clamp, makeSignalId, sideToSignal } from './math.js';
import { classifyRegime } from './strategies/regime.js';
import { evaluateEntryQuality } from './strategies/entry-quality.js';
import { evaluateMicrostructure } from './strategies/microstructure.js';
import { evaluateSniper } from './strategies/sniper.js';
import { evaluateForecastEdge } from './strategies/forecast-edge.js';
import { evaluateSyntheticBasket } from './strategies/synthetic-arb.js';

function expiry(now: number, cfg: OracleConfig, overrideSec?: number): number {
  const ttl = overrideSec ? Math.max(1_000, overrideSec * 1000) : cfg.ttlMs;
  return now + ttl;
}

/**
 * Generate raw oracle signals from the market context.
 * This is intentionally payment-free and execution-free.
 */
export function generateRawOracleSignals(input: OracleInput, partialConfig: Partial<OracleConfig> = {}): RawOracleSignal[] {
  const cfg = { ...DEFAULT_ORACLE_CONFIG, ...partialConfig };
  const now = Date.now();
  const token = input.token.toUpperCase();
  const samples = input.samples ?? [];
  const price = input.spotPrice;
  const signals: RawOracleSignal[] = [];

  if (input.marketProbability !== undefined) {
    const p = clamp(input.marketProbability, 0, 1);
    const side = p > 0.51 ? 'BUY' : p < 0.49 ? 'SELL' : 'HOLD';
    signals.push({
      signalId: makeSignalId('polyprob', token, now),
      producer: 'PYTHIA_ORACLE',
      token,
      side,
      kind: 'POLYMARKET_PROBABILITY',
      confidence: clamp(Math.round(Math.abs(p - 0.5) * 200 + 55), 0, 95),
      price,
      marketProbability: p,
      vetoes: side === 'HOLD' ? ['probability_near_50_50'] : [],
      warnings: [],
      evidence: { marketProbability: p },
      reasoning: `market-implied probability ${(p * 100).toFixed(1)}%`,
      generatedAt: now,
      expiresAt: expiry(now, cfg, input.timeToCloseSec),
    });
  }

  if (input.openPrice && input.thresholdUsd && samples.length >= 2) {
    const regime = classifyRegime(samples, input.openPrice, price, input.thresholdUsd, cfg, input.observedAtMs ?? now);
    signals.push({
      signalId: makeSignalId('regime', token, now),
      producer: 'PYTHIA_ORACLE',
      token,
      side: sideToSignal(regime.side),
      kind: 'MOMENTUM_REGIME',
      confidence: regime.confidence,
      price,
      edgeBps: input.openPrice > 0 ? Math.round((regime.signedEdge / input.openPrice) * 10_000) : undefined,
      regime: regime.regime,
      vetoes: regime.regime === 'FAKEOUT_RISK' ? ['regime_fakeout_risk'] : [],
      warnings: regime.regime === 'SIDEWAY' ? ['sideway_or_low_edge'] : [],
      evidence: { regime },
      reasoning: `${regime.reason}; edge=${regime.edge.toFixed(2)}; retracement=${(regime.retracementPct * 100).toFixed(1)}%; flips=${regime.signFlipCount}`,
      generatedAt: now,
      expiresAt: expiry(now, cfg, input.timeToCloseSec),
    });

    if (input.intendedBook) {
      const q = evaluateEntryQuality({
        cfg,
        side: regime.side,
        entryMode: regime.regime === 'SIDEWAY' ? 'sideway_micro_scalp' : 'momentum',
        signal: regime,
        samples,
        openPrice: input.openPrice,
        priceNow: price,
        thresholdUsd: input.thresholdUsd,
        elapsedSec: input.elapsedSec ?? 0,
        intendedBook: input.intendedBook,
        oppositeBook: input.oppositeBook ?? null,
        targetShares: input.targetShares ?? 10,
        maxEntryPrice: input.maxEntryPrice ?? input.intendedBook.bestAsk + cfg.slippageBuffer,
        tickSize: input.tickSize ?? 0.01,
        bookAgeMs: input.bookAgeMs ?? 0,
        priceAgeMs: input.priceAgeMs ?? 0,
        previousIntendedBook: input.previousIntendedBook ?? null,
      });
      signals.push({
        signalId: makeSignalId('entryq', token, now),
        producer: 'PYTHIA_ORACLE',
        token,
        side: q.passed ? sideToSignal(regime.side) : 'HOLD',
        kind: 'ENTRY_QUALITY',
        confidence: clamp(Math.round(q.score - q.vetoes.length * 10), 0, 95),
        price,
        fairProbability: q.lag + input.intendedBook.bestAsk,
        qualityScore: q.score,
        stakeMultiplierHint: q.stakeMultiplierHint,
        regime: regime.regime,
        vetoes: q.vetoes,
        warnings: q.warnings,
        evidence: { entryQuality: q },
        reasoning: `entry quality ${q.score.toFixed(1)}/${q.requiredScore}; fillProb=${(q.fillProbability * 100).toFixed(0)}%; lag=${q.lag.toFixed(3)}`,
        generatedAt: now,
        expiresAt: expiry(now, cfg, input.timeToCloseSec),
      });

      const micro = evaluateMicrostructure({
        side: regime.side,
        intendedBook: input.intendedBook,
        oppositeBook: input.oppositeBook ?? null,
        previousIntendedBook: input.previousIntendedBook ?? null,
        samples,
        openPrice: input.openPrice,
        priceNow: price,
        thresholdUsd: input.thresholdUsd,
        elapsedSec: input.elapsedSec ?? 0,
        tickSize: input.tickSize ?? 0.01,
        targetShares: input.targetShares ?? 10,
        fillProbability: q.fillProbability,
      });
      signals.push({
        signalId: makeSignalId('micro', token, now),
        producer: 'PYTHIA_ORACLE',
        token,
        side: micro.vetoes.length === 0 ? sideToSignal(regime.side) : 'HOLD',
        kind: 'MICROSTRUCTURE',
        confidence: clamp(90 - micro.scorePenalty, 0, 95),
        price,
        regime: regime.regime,
        vetoes: micro.vetoes,
        warnings: micro.warnings,
        evidence: { microstructure: micro },
        reasoning: micro.signals.length ? micro.signals.map(s => `${s.name}:${s.severity}`).join(', ') : 'microstructure clean',
        generatedAt: now,
        expiresAt: expiry(now, cfg, input.timeToCloseSec),
      });
    }

    const sniper = evaluateSniper({
      cfg,
      openPrice: input.openPrice,
      priceNow: price,
      samples,
      elapsedSec: input.elapsedSec ?? 0,
      upBook: regime.side === 'UP' ? input.intendedBook : input.oppositeBook ?? undefined,
      downBook: regime.side === 'DOWN' ? input.intendedBook : input.oppositeBook ?? undefined,
      tickSize: input.tickSize ?? 0.01,
      marketProbability: input.marketProbability,
      bookAgeMs: input.bookAgeMs,
    });
    signals.push({
      signalId: makeSignalId('sniper', token, now),
      producer: 'PYTHIA_ORACLE',
      token,
      side: sniper.active ? sideToSignal(sniper.side) : 'HOLD',
      kind: 'SNIPER',
      confidence: sniper.confidence,
      price,
      qualityScore: sniper.score,
      vetoes: sniper.vetoes,
      warnings: sniper.warnings,
      evidence: { sniper },
      reasoning: sniper.reason,
      generatedAt: now,
      expiresAt: expiry(now, cfg, input.timeToCloseSec),
    });
  }

  if (input.forecastProbability !== undefined && input.marketProbability !== undefined) {
    const f = evaluateForecastEdge({ cfg, forecastProbability: input.forecastProbability, marketProbability: input.marketProbability, sigma: input.forecastSigma, timeToCloseSec: input.timeToCloseSec });
    signals.push({
      signalId: makeSignalId('forecast', token, now),
      producer: 'PYTHIA_ORACLE',
      token,
      side: f.side,
      kind: 'FORECAST_EDGE',
      confidence: f.confidence,
      price,
      fairProbability: f.forecastProbability,
      marketProbability: f.marketProbability,
      edgeBps: f.edgeBps,
      vetoes: f.vetoes,
      warnings: f.warnings,
      evidence: { forecast: f },
      reasoning: f.reason,
      generatedAt: now,
      expiresAt: expiry(now, cfg, input.timeToCloseSec),
    });
  }

  if (input.dualOutcomeBook) {
    const arb = evaluateSyntheticBasket(input.dualOutcomeBook, cfg);
    signals.push({
      signalId: makeSignalId('arb', token, now),
      producer: 'PYTHIA_ORACLE',
      token,
      side: arb.active ? 'BUY' : 'HOLD',
      kind: 'SYNTHETIC_ARBITRAGE',
      confidence: arb.confidence,
      price,
      netEdgeBps: arb.netEdgeBps,
      qualityScore: Math.round(arb.tradeQuality * 100),
      vetoes: arb.vetoes,
      warnings: arb.warnings,
      evidence: { syntheticArb: arb },
      reasoning: arb.reason,
      generatedAt: now,
      expiresAt: expiry(now, cfg, input.timeToCloseSec),
    });
  }

  if (signals.length === 0) {
    signals.push({
      signalId: makeSignalId('empty', token, now),
      producer: 'PYTHIA_ORACLE',
      token,
      side: 'HOLD',
      kind: 'POLYMARKET_PROBABILITY',
      confidence: 10,
      price,
      vetoes: ['insufficient_oracle_inputs'],
      warnings: [],
      evidence: { inputKeys: Object.keys(input) },
      reasoning: 'not enough input to build raw oracle signal',
      generatedAt: now,
      expiresAt: now + cfg.ttlMs,
    });
  }

  return signals;
}
