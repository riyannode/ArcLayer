import { createHash, randomUUID } from 'node:crypto';
import type { RawOracleSignal, ResolvedSignalDecision, ResolverInput, ResolverPolicy, SignalSide } from './types.js';
import { mergePolicy } from './risk-policy.js';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function id(prefix: string, token: string): string {
  try { return `${prefix}_${token}_${randomUUID()}`; } catch {}
  return `${prefix}_${token}_${createHash('sha256').update(`${token}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 16)}`;
}

function emptyDecision(input: ResolverInput, status: ResolvedSignalDecision['status'], reason: string, now: number): ResolvedSignalDecision {
  return {
    decisionId: id('decision', input.token.toUpperCase()),
    resolver: 'ARCLAYER_RESOLVER',
    token: input.token.toUpperCase(),
    finalSignal: 'HOLD',
    status,
    confidence: 0,
    riskLevel: 'BLOCKED',
    actionHint: status === 'EXIT_WARNING' ? 'reduce_or_close' : 'do_not_use',
    price: 0,
    reasons: [reason],
    vetoes: [reason],
    warnings: [],
    sourceSignals: [],
    generatedAt: now,
    expiresAt: now + 10_000,
  };
}

function sideScore(signals: RawOracleSignal[], side: Exclude<SignalSide, 'HOLD'>, policy: ResolverPolicy): number {
  return signals.reduce((score, signal) => {
    if (signal.side !== side) return score;
    if (signal.kind === 'SYNTHETIC_ARBITRAGE' && !policy.allowSyntheticArbAsBuy) return score;
    const weight = policy.kindWeights[signal.kind] ?? 1;
    const qualityBoost = signal.qualityScore !== undefined ? clamp(signal.qualityScore / 100, 0.4, 1.2) : 1;
    const edgeBoost = signal.edgeBps !== undefined ? clamp(Math.abs(signal.edgeBps) / 600, 0.5, 1.35) : 1;
    const netEdgeBoost = signal.netEdgeBps !== undefined ? clamp(Math.max(0, signal.netEdgeBps) / 500, 0.4, 1.30) : 1;
    const vetoPenalty = Math.max(0.25, 1 - signal.vetoes.length * 0.18);
    return score + signal.confidence * weight * qualityBoost * edgeBoost * netEdgeBoost * vetoPenalty;
  }, 0);
}

function collectVetoes(signals: RawOracleSignal[]): string[] {
  return [...new Set(signals.flatMap((signal) => signal.vetoes ?? []))];
}

function collectWarnings(signals: RawOracleSignal[]): string[] {
  return [...new Set(signals.flatMap((signal) => signal.warnings ?? []))];
}

function hasRejectVeto(vetoes: string[], policy: ResolverPolicy): string | null {
  for (const veto of vetoes) if (policy.rejectVetoes.has(veto)) return veto;
  return null;
}

function hasDowngradeVeto(vetoes: string[], policy: ResolverPolicy): string | null {
  for (const veto of vetoes) if (policy.downgradeVetoes.has(veto)) return veto;
  return null;
}

function maybeExitWarning(input: ResolverInput, fresh: RawOracleSignal[], now: number): ResolvedSignalDecision | null {
  if (!input.previousDecision || input.previousDecision.status !== 'APPROVED') return null;
  const prev = input.previousDecision.finalSignal;
  if (prev === 'HOLD') return null;
  const opposite = prev === 'BUY' ? 'SELL' : 'BUY';
  const strongOpposite = fresh.filter((s) => s.side === opposite && s.confidence >= 70);
  const hardVeto = collectVetoes(fresh).find((v) => ['fake_breakout_reversal', 'late_minute_reversal', 'liquidity_vacuum', 'adverse_fill_probability_high'].includes(v));
  if (strongOpposite.length >= 2 || hardVeto) {
    return {
      decisionId: id('decision', input.token.toUpperCase()),
      resolver: 'ARCLAYER_RESOLVER',
      token: input.token.toUpperCase(),
      finalSignal: 'HOLD',
      status: 'EXIT_WARNING',
      confidence: 70,
      riskLevel: 'HIGH',
      actionHint: 'reduce_or_close',
      price: fresh[0]?.price ?? input.previousDecision.price,
      reasons: [hardVeto ? `exit warning from ${hardVeto}` : `opposite ${opposite} signals invalidated previous ${prev}`],
      vetoes: hardVeto ? [hardVeto] : [],
      warnings: collectWarnings(fresh),
      sourceSignals: fresh,
      generatedAt: now,
      expiresAt: Math.min(...fresh.map((s) => s.expiresAt), now + 15_000),
    };
  }
  return null;
}

/**
 * Paid Resolver decision layer.
 * Consumes raw Oracle signals and returns exactly one final signal for downstream agents.
 */
export function resolveSignals(input: ResolverInput, partialPolicy?: Partial<ResolverPolicy>): ResolvedSignalDecision {
  const policy = mergePolicy(partialPolicy);
  const now = input.nowMs ?? Date.now();
  const token = input.token.toUpperCase();
  const valid = input.rawSignals.filter((s) => s.token.toUpperCase() === token);
  if (valid.length === 0) return emptyDecision(input, 'REJECTED', 'no_raw_signals_for_token', now);

  const fresh = valid.filter((s) => now <= s.expiresAt && now - s.generatedAt <= policy.maxSignalAgeMs);
  if (fresh.length === 0) return emptyDecision(input, 'REJECTED', 'all_raw_signals_expired_or_stale', now);

  const exit = maybeExitWarning(input, fresh, now);
  if (exit) return exit;

  const vetoes = collectVetoes(fresh);
  const warnings = collectWarnings(fresh);
  const hardReject = hasRejectVeto(vetoes, policy);
  if (hardReject) {
    return {
      decisionId: id('decision', token),
      resolver: 'ARCLAYER_RESOLVER',
      token,
      finalSignal: 'HOLD',
      status: 'REJECTED',
      confidence: 0,
      riskLevel: 'BLOCKED',
      actionHint: 'do_not_use',
      price: fresh[0]?.price ?? 0,
      reasons: [`hard veto: ${hardReject}`],
      vetoes,
      warnings,
      sourceSignals: fresh,
      generatedAt: now,
      expiresAt: Math.min(...fresh.map((s) => s.expiresAt)),
    };
  }

  const buyScore = sideScore(fresh, 'BUY', policy);
  const sellScore = sideScore(fresh, 'SELL', policy);
  const scoreGap = Math.abs(buyScore - sellScore);
  const finalSignal: SignalSide = buyScore > sellScore ? 'BUY' : sellScore > buyScore ? 'SELL' : 'HOLD';
  const bestScore = Math.max(buyScore, sellScore);
  const confidence = clamp(Math.round(bestScore / Math.max(1, fresh.filter((s) => s.side === finalSignal).length || 1)), 0, 95);
  const reasons: string[] = [
    `buyScore=${buyScore.toFixed(1)}`,
    `sellScore=${sellScore.toFixed(1)}`,
    `scoreGap=${scoreGap.toFixed(1)}`,
  ];

  if (finalSignal === 'HOLD' || scoreGap < policy.minForwardScoreGap) {
    return {
      decisionId: id('decision', token), resolver: 'ARCLAYER_RESOLVER', token,
      finalSignal: 'HOLD', status: 'DOWNGRADED', confidence: Math.min(confidence, 45),
      riskLevel: 'HIGH', actionHint: 'hold', price: fresh[0]?.price ?? 0,
      reasons: [...reasons, 'conflicting_or_weak_signal_gap'], vetoes, warnings,
      sourceSignals: fresh, generatedAt: now, expiresAt: Math.min(...fresh.map((s) => s.expiresAt)),
    };
  }

  const downgradeVeto = hasDowngradeVeto(vetoes, policy);
  if (downgradeVeto || confidence < policy.minApprovedConfidence) {
    return {
      decisionId: id('decision', token), resolver: 'ARCLAYER_RESOLVER', token,
      finalSignal: 'HOLD', status: 'DOWNGRADED', confidence: Math.min(confidence, 55),
      riskLevel: 'HIGH', actionHint: 'hold', price: fresh[0]?.price ?? 0,
      reasons: [...reasons, downgradeVeto ? `downgrade veto: ${downgradeVeto}` : `confidence ${confidence} < ${policy.minApprovedConfidence}`],
      vetoes, warnings, sourceSignals: fresh, generatedAt: now, expiresAt: Math.min(...fresh.map((s) => s.expiresAt)),
    };
  }

  return {
    decisionId: id('decision', token), resolver: 'ARCLAYER_RESOLVER', token,
    finalSignal, status: 'APPROVED', confidence,
    riskLevel: confidence >= 82 && warnings.length <= 1 ? 'LOW' : confidence >= 70 ? 'MEDIUM' : 'HIGH',
    actionHint: 'forward_signal', price: fresh[0]?.price ?? 0,
    reasons: [...reasons, `approved ${finalSignal}`], vetoes, warnings,
    sourceSignals: fresh, generatedAt: now, expiresAt: Math.min(...fresh.map((s) => s.expiresAt)),
  };
}
