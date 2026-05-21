import type { DualOutcomeBook, OracleConfig, SyntheticArbSignal } from '../types.js';
import { clamp, clamp01 } from '../math.js';

function visibleLiquidity(book: DualOutcomeBook): number {
  const top = [...book.up.asks.slice(0, 3), ...book.down.asks.slice(0, 3)];
  return top.reduce((sum, l) => sum + l.price * l.size, 0);
}

function bookInstability(book: DualOutcomeBook): number {
  const upSpread = Math.max(0, book.up.bestAsk - book.up.bestBid);
  const downSpread = Math.max(0, book.down.bestAsk - book.down.bestBid);
  return clamp01((upSpread + downSpread) / 0.16);
}

/**
 * Rust arbitrage engine distilled into pure signal output.
 * Looks for UP ask + DOWN ask below 1.00 after cost buffer.
 */
export function evaluateSyntheticBasket(book: DualOutcomeBook, cfg: OracleConfig): SyntheticArbSignal {
  const upAsk = book.up.bestAsk;
  const downAsk = book.down.bestAsk;
  const totalPrice = upAsk + downAsk;
  const grossEdgeBps = Math.round((1 - totalPrice) * 10_000);
  const estimatedCostBps = cfg.estimatedSyntheticCostBps;
  const netEdgeBps = grossEdgeBps - estimatedCostBps;
  const liquidity = visibleLiquidity(book);
  const instability = bookInstability(book);
  const confidence = clamp01(1 - instability);
  const tradeQuality = clamp01((netEdgeBps / 600) * confidence * clamp01(liquidity / 50));
  const vetoes: string[] = [];
  const warnings: string[] = [];
  if (totalPrice >= 1) vetoes.push('ask_sum_not_below_one');
  if (netEdgeBps < cfg.minSyntheticNetEdgeBps) vetoes.push('synthetic_net_edge_below_min');
  if (liquidity < 10) vetoes.push('synthetic_liquidity_below_min');
  if (instability > 0.75) vetoes.push('synthetic_book_instability_high');
  if (grossEdgeBps > 0 && netEdgeBps <= 0) warnings.push('gross_edge_erased_by_costs');
  const legSize = Math.max(0, Math.min(book.up.asks[0]?.size ?? 0, book.down.asks[0]?.size ?? 0));
  return {
    active: vetoes.length === 0,
    grossEdgeBps,
    estimatedCostBps,
    netEdgeBps,
    confidence: Math.round(confidence * 100),
    tradeQuality,
    vetoes,
    warnings,
    reason: vetoes.length === 0 ? 'binary basket priced below guaranteed payout after costs' : 'synthetic basket does not clear risk/edge gates',
    legs: [
      { outcome: 'UP', tokenId: book.up.tokenId, price: upAsk, size: legSize },
      { outcome: 'DOWN', tokenId: book.down.tokenId, price: downAsk, size: legSize },
    ],
  };
}
