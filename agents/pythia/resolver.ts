/**
 * Pythia oracle resolver.
 *
 * Decides YES/NO outcome for an Ignia market based on a price source.
 * For demo, uses CoinGecko spot price; falls back to internal mock signal price.
 */

import { generateSignal } from './logic.js';
import {
  IgniaOutcome,
  readMarket,
  resolveIgniaMarket,
  type IgniaMarket,
} from '../shared/ignia.js';

export interface ResolutionDecision {
  marketId: bigint;
  question: string;
  outcome: IgniaOutcome;
  source: 'coingecko' | 'pythia-polymarket' | 'manual';
  evidencePrice: number;
  threshold?: number;
  symbol?: string;
  reasoning: string;
}

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
};

async function fetchCoinGeckoPrice(symbol: string): Promise<number | null> {
  const id = COINGECKO_IDS[symbol.toUpperCase()];
  if (!id) return null;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, {
      headers: { 'accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { usd?: number }>;
    return data[id]?.usd ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse a question into { symbol, op, threshold }.
 * Supports two grammars:
 *   1. Operator form:   "BTC > 105000", "ETH >= 4000", "SOL < 200"
 *   2. Natural form:    "Will Bitcoin be above $100k by ...", "ETH below 4000", "SOL over $200"
 * Number suffixes "k" (1e3) and "m" (1e6) are honored.
 */
const SYMBOL_ALIASES: Record<string, string> = {
  BTC: 'BTC', BITCOIN: 'BTC',
  ETH: 'ETH', ETHEREUM: 'ETH', ETHER: 'ETH',
  SOL: 'SOL', SOLANA: 'SOL',
};

function parseNumberWithSuffix(raw: string): number | null {
  const cleaned = raw.replace(/[_,]/g, '').toLowerCase();
  const m = cleaned.match(/^([0-9]*\.?[0-9]+)([km])?$/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === 'k') n *= 1_000;
  else if (m[2] === 'm') n *= 1_000_000;
  return n;
}

export function parseMarketQuestion(question: string): { symbol: string; op: '>' | '>=' | '<' | '<='; threshold: number } | null {
  // Grammar 1: explicit operators (BTC > 105000)
  const opRe = /\b(BTC|ETH|SOL|BITCOIN|ETHEREUM|ETHER|SOLANA)\b\s*(>=|<=|>|<)\s*\$?([0-9][0-9_,\.]*[km]?)/i;
  const opMatch = question.match(opRe);
  if (opMatch) {
    const symbol = SYMBOL_ALIASES[opMatch[1].toUpperCase()];
    const threshold = parseNumberWithSuffix(opMatch[3]);
    if (symbol && threshold !== null) {
      return { symbol, op: opMatch[2] as '>' | '>=' | '<' | '<=', threshold };
    }
  }

  // Grammar 2: natural language (Bitcoin above $100k)
  const natRe = /\b(BTC|ETH|SOL|BITCOIN|ETHEREUM|ETHER|SOLANA)\b[^$0-9]*?\b(above|over|greater than|higher than|below|under|less than|lower than)\b\s*\$?([0-9][0-9_,\.]*[km]?)/i;
  const natMatch = question.match(natRe);
  if (natMatch) {
    const symbol = SYMBOL_ALIASES[natMatch[1].toUpperCase()];
    const word = natMatch[2].toLowerCase();
    const threshold = parseNumberWithSuffix(natMatch[3]);
    if (symbol && threshold !== null) {
      const isAbove = ['above', 'over', 'greater than', 'higher than'].includes(word);
      return { symbol, op: isAbove ? '>' : '<', threshold };
    }
  }

  return null;
}

function evaluateThreshold(price: number, op: string, threshold: number): IgniaOutcome {
  switch (op) {
    case '>': return price > threshold ? IgniaOutcome.YES : IgniaOutcome.NO;
    case '>=': return price >= threshold ? IgniaOutcome.YES : IgniaOutcome.NO;
    case '<': return price < threshold ? IgniaOutcome.YES : IgniaOutcome.NO;
    case '<=': return price <= threshold ? IgniaOutcome.YES : IgniaOutcome.NO;
    default: return IgniaOutcome.UNRESOLVED;
  }
}

export async function decideOutcome(market: IgniaMarket): Promise<ResolutionDecision> {
  const parsed = parseMarketQuestion(market.question);

  if (parsed) {
    const price = await fetchCoinGeckoPrice(parsed.symbol);
    if (price !== null) {
      const outcome = evaluateThreshold(price, parsed.op, parsed.threshold);
      return {
        marketId: market.id,
        question: market.question,
        outcome,
        source: 'coingecko',
        evidencePrice: price,
        threshold: parsed.threshold,
        symbol: parsed.symbol,
        reasoning: `${parsed.symbol} spot=${price} ${parsed.op} ${parsed.threshold} → ${outcome === IgniaOutcome.YES ? 'YES' : 'NO'}`,
      };
    }
    // Fallback: use Pythia live Polymarket-backed signal price
    const signal = await generateSignal(parsed.symbol);
    const outcome = evaluateThreshold(signal.price, parsed.op, parsed.threshold);
    return {
      marketId: market.id,
      question: market.question,
      outcome,
      source: 'pythia-polymarket',
      evidencePrice: signal.price,
      threshold: parsed.threshold,
      symbol: parsed.symbol,
      reasoning: `coingecko unreachable; pythia-polymarket ${parsed.symbol}=${signal.price} ${parsed.op} ${parsed.threshold} → ${outcome === IgniaOutcome.YES ? 'YES' : 'NO'}`,
    };
  }

  // Unparseable: cannot auto-resolve
  return {
    marketId: market.id,
    question: market.question,
    outcome: IgniaOutcome.UNRESOLVED,
    source: 'manual',
    evidencePrice: 0,
    reasoning: `question format not recognized; manual resolve required`,
  };
}

export interface ResolveResult {
  decision: ResolutionDecision;
  txHash?: string;
  status: 'resolved' | 'skipped-deadline' | 'skipped-already-resolved' | 'skipped-unparseable' | 'error';
  error?: string;
}

export async function resolveIgniaWithPythia(
  oraclePrivateKey: `0x${string}`,
  marketId: bigint,
  opts: { dryRun?: boolean } = {},
): Promise<ResolveResult> {
  const market = await readMarket(marketId);

  if (market.outcome !== IgniaOutcome.UNRESOLVED) {
    return {
      decision: { marketId, question: market.question, outcome: market.outcome, source: 'manual', evidencePrice: 0, reasoning: 'already resolved' },
      status: 'skipped-already-resolved',
    };
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (nowSeconds < market.resolutionDeadline) {
    return {
      decision: { marketId, question: market.question, outcome: IgniaOutcome.UNRESOLVED, source: 'manual', evidencePrice: 0, reasoning: `deadline in future (${market.resolutionDeadline})` },
      status: 'skipped-deadline',
    };
  }

  const decision = await decideOutcome(market);

  if (decision.outcome === IgniaOutcome.UNRESOLVED) {
    return { decision, status: 'skipped-unparseable' };
  }

  if (opts.dryRun) {
    return { decision, status: 'resolved' };
  }

  try {
    const { txHash } = await resolveIgniaMarket(oraclePrivateKey, marketId, decision.outcome);
    return { decision, txHash, status: 'resolved' };
  } catch (err: any) {
    return { decision, status: 'error', error: err?.message ?? String(err) };
  }
}
