import type { ResolvedSignalDecision, TradingSignalCompat } from './types.js';

/** Converts Resolver decision to your current Hermes/Pythia TradingSignal shape. */
export function toTradingSignal(decision: ResolvedSignalDecision): TradingSignalCompat {
  return {
    token: decision.token,
    signal: decision.status === 'APPROVED' ? decision.finalSignal : 'HOLD',
    confidence: decision.confidence,
    price: decision.price,
    reasoning: [
      `resolver=${decision.status}`,
      `risk=${decision.riskLevel}`,
      ...decision.reasons,
      decision.vetoes.length ? `vetoes=${decision.vetoes.join(',')}` : '',
      decision.warnings.length ? `warnings=${decision.warnings.join(',')}` : '',
    ].filter(Boolean).join('. '),
    timestamp: decision.generatedAt,
  };
}
