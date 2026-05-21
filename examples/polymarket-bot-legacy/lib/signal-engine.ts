/**
 * Shared 15-minute Polymarket signal derivation.
 *
 * Used by:
 *   - apps/console/src/app/api/a2a/live-signal/route.ts (UI live mode)
 *   - apps/console/scripts/agent-market-runner.ts (autonomous 15m loop)
 *
 * Two reasoning modes:
 *   - 'deterministic' (default): pure spread/volume heuristic, no network LLM call
 *   - 'llm': calls the configured LLM gateway for Pythia + Apolo reasoning,
 *            falls back to deterministic if the LLM call fails
 *
 * 15-minute window alignment matches Polymarket's `*-updown-15m-<unix>` slug
 * convention. The unix is floor(now / 900) * 900.
 */
// NOTE: No 'server-only' — shared between Next.js API routes and standalone
// tsx runner scripts (agent-market-runner, update-trade-pnl).

export type Asset = 'BTC' | 'ETH';
export type Direction = 'UP' | 'DOWN' | 'NEUTRAL';
export type HermesAction = 'BUY_UP' | 'BUY_DOWN' | 'SKIP';
export type ReasoningMode = 'deterministic' | 'llm';

export const FIFTEEN_MIN_SEC = 900;

export interface MarketSnapshot {
  slug: string;
  question: string;
  asset: Asset;
  upPrice: number;
  downPrice: number;
  spread: number;
  volume: number | null;
  windowStart: number;
  windowEnd: number;
}

export interface PythiaOutput {
  rawSignal: Direction;
  confidence: number;
  features: string[];
  reasoning?: string;
}

export interface ApoloOutput {
  decision: Direction;
  status: 'APPROVED' | 'REJECTED';
  confidence: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
  reasoning?: string;
}

export interface HermesOutput {
  action: HermesAction;
  sizeUsdc: string;
  mode: 'DRY_RUN' | 'LIVE';
}

export interface DerivedSignal {
  market: MarketSnapshot;
  pythia: PythiaOutput;
  apolo: ApoloOutput;
  hermes: HermesOutput;
  reasoningMode: ReasoningMode;
}

// ─── Window alignment ────────────────────────────────────────────────────────

export function alignedWindow(nowMs: number = Date.now()): { start: number; end: number } {
  const now = Math.floor(nowMs / 1000);
  const start = now - (now % FIFTEEN_MIN_SEC);
  return { start, end: start + FIFTEEN_MIN_SEC };
}

function parsePrices(raw: string | undefined): [number, number] {
  try {
    const arr = JSON.parse(raw || '["0.5","0.5"]');
    return [Number(arr[0]) || 0.5, Number(arr[1]) || 0.5];
  } catch {
    return [0.5, 0.5];
  }
}

// ─── Polymarket fetcher ──────────────────────────────────────────────────────

/**
 * Fetch the current 15m market for an asset. Tries the current and prior windows
 * because Polymarket sometimes lags the new window by a minute or two.
 *
 * Polymarket slug convention for 15m: `btc-updown-15m-<unix>` / `eth-updown-15m-<unix>`.
 * The 5m markets use `*-updown-5m-*`. We only request 15m here to stay within
 * the user's API budget.
 */
export async function fetchMarket15m(asset: Asset, nowMs: number = Date.now()): Promise<MarketSnapshot | null> {
  const { start } = alignedWindow(nowMs);
  const candidates = [start, start - FIFTEEN_MIN_SEC];
  const slugBase = asset === 'BTC' ? 'btc-updown-15m' : 'eth-updown-15m';

  for (const ws of candidates) {
    const slug = `${slugBase}-${ws}`;
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const markets = await res.json();
      if (!Array.isArray(markets) || markets.length === 0) continue;
      const m = markets[0];
      const [upPrice, downPrice] = parsePrices(m.outcomePrices);
      return {
        slug: m.slug,
        question: m.question || `${asset} 15m UP/DOWN`,
        asset,
        upPrice,
        downPrice,
        spread: Math.abs(upPrice - downPrice),
        volume: m.volume ? Number(m.volume) : null,
        windowStart: ws,
        windowEnd: ws + FIFTEEN_MIN_SEC,
      };
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ─── Deterministic reasoning ─────────────────────────────────────────────────

/**
 * Pure-function signal derivation. No LLM, no network beyond the input snapshot.
 * Used as the default and as the LLM fallback when the LLM call fails.
 */
export function deriveSignalDeterministic(market: MarketSnapshot): DerivedSignal {
  const { upPrice, downPrice, spread, volume, asset } = market;

  // 15m spreads are tighter than 5m; relax the neutral threshold slightly.
  const direction: Direction = spread < 0.015 ? 'NEUTRAL' : upPrice > downPrice ? 'UP' : 'DOWN';

  // Confidence: spread provides the bulk, volume nudges it up modestly.
  // 15m markets carry less volume than 5m, so we cap the volume bonus lower.
  const volBonus = Math.min((volume ?? 0) / 400, 8);
  const confidence = Math.min(92, Math.max(50, Math.round(50 + spread * 1000 + volBonus)));

  const risk: 'LOW' | 'MEDIUM' | 'HIGH' = confidence >= 70 ? 'LOW' : confidence >= 58 ? 'MEDIUM' : 'HIGH';
  const approved = direction !== 'NEUTRAL' && confidence >= 56;
  const action: HermesAction = !approved ? 'SKIP' : direction === 'UP' ? 'BUY_UP' : 'BUY_DOWN';

  const features = [
    `${asset} 15m UP/DOWN orderbook midpoint`,
    `UP ${upPrice.toFixed(3)} / DOWN ${downPrice.toFixed(3)}`,
    `micro-edge ${spread.toFixed(3)}`,
    volume != null ? `volume $${volume.toFixed(2)}` : 'volume pending',
  ];

  return {
    market,
    pythia: {
      rawSignal: direction,
      confidence,
      features,
    },
    apolo: {
      decision: direction,
      status: approved ? 'APPROVED' : 'REJECTED',
      confidence,
      risk,
      reason: approved
        ? `Edge passed Apolo risk gate; ${direction} probability leads by ${(spread * 100).toFixed(1)} pts.`
        : 'No sufficient 15m edge; resolver rejects execution.',
    },
    hermes: {
      action,
      sizeUsdc: approved ? '0.10' : '0.00',
      mode: 'DRY_RUN',
    },
    reasoningMode: 'deterministic',
  };
}

// ─── LLM reasoning (optional) ────────────────────────────────────────────────

interface LLMConfig {
  endpoint: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
  maxTokens: number;
}

function llmConfig(): LLMConfig {
  const base = process.env.A2A_LLM_ENDPOINT || process.env.ARCLAYER_AGENT_ENDPOINT || 'http://localhost:20128/v1';
  const endpoint = base.endsWith('/chat/completions') ? base : `${base.replace(/\/$/, '')}/chat/completions`;
  return {
    endpoint,
    model: process.env.A2A_LLM_MODEL || process.env.ARCLAYER_AGENT_MODEL || 'cx/gpt-5.5',
    apiKey: process.env.A2A_LLM_API_KEY || process.env.ARCLAYER_AGENT_API_KEY || null,
    timeoutMs: Number(process.env.A2A_LLM_TIMEOUT_MS || 20_000),
    maxTokens: Number(process.env.A2A_LLM_MAX_TOKENS || 400),
  };
}

const PYTHIA_SYSTEM = `You are Pythia, the signal/oracle agent in the ArcLayer A2A pipeline.
You read live Polymarket 15-minute UP/DOWN crypto market snapshots and emit a calibrated directional signal.
Output STRICT JSON only with this shape:
{ "rawSignal": "UP" | "DOWN" | "NEUTRAL", "confidence": 0-100 integer, "reasoning": "<= 280 chars" }
Rules:
- NEUTRAL when |UP-DOWN| < 0.015.
- Confidence reflects edge size (spread) and volume tape.
- Be terse. Cite spread and volume in reasoning.`;

const APOLO_SYSTEM = `You are Apolo, the decision/risk agent in the ArcLayer A2A pipeline.
You receive Pythia's signal plus the raw market snapshot and decide whether to APPROVE or REJECT execution.
Output STRICT JSON only with this shape:
{ "decision": "UP" | "DOWN" | "NEUTRAL", "status": "APPROVED" | "REJECTED", "confidence": 0-100 integer, "risk": "LOW" | "MEDIUM" | "HIGH", "reasoning": "<= 280 chars" }
Rules:
- REJECT when raw signal is NEUTRAL or Pythia confidence < 56.
- LOW risk: confidence >= 70. MEDIUM: 58-69. HIGH: < 58.
- You may downgrade Pythia's confidence but never raise it.
- Be terse and decisive.`;

async function callLLM(system: string, user: string, cfg: LLMConfig): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  try {
    const resp = await fetch(cfg.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        // Many gateways accept response_format=json — best-effort hint.
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`llm_http_${resp.status}`);
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('llm_empty');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function tryParseJson<T>(raw: string): T | null {
  // Strip markdown fences if the model wrapped its output.
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    // Try to find a {...} block.
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {}
    }
    return null;
  }
}

interface PythiaJson {
  rawSignal?: Direction;
  confidence?: number;
  reasoning?: string;
}

interface ApoloJson {
  decision?: Direction;
  status?: 'APPROVED' | 'REJECTED';
  confidence?: number;
  risk?: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning?: string;
}

function clampConfidence(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * LLM-augmented derivation. Falls back to deterministic on any failure.
 */
export async function deriveSignalLLM(market: MarketSnapshot): Promise<DerivedSignal> {
  const baseline = deriveSignalDeterministic(market);
  const cfg = llmConfig();

  // Skip LLM if nothing reachable — deterministic is the safe default.
  if (!cfg.endpoint) return baseline;

  const marketJson = JSON.stringify({
    asset: market.asset,
    upPrice: market.upPrice,
    downPrice: market.downPrice,
    spread: market.spread,
    volume: market.volume,
    window: `${new Date(market.windowStart * 1000).toISOString()} → ${new Date(market.windowEnd * 1000).toISOString()}`,
  });

  // Pythia call
  let pythia: PythiaOutput = baseline.pythia;
  try {
    const raw = await callLLM(PYTHIA_SYSTEM, `Market snapshot:\n${marketJson}\n\nEmit your signal JSON.`, cfg);
    const parsed = tryParseJson<PythiaJson>(raw);
    if (parsed && (parsed.rawSignal === 'UP' || parsed.rawSignal === 'DOWN' || parsed.rawSignal === 'NEUTRAL')) {
      pythia = {
        rawSignal: parsed.rawSignal,
        confidence: clampConfidence(parsed.confidence, baseline.pythia.confidence),
        features: baseline.pythia.features,
        reasoning: parsed.reasoning?.slice(0, 280),
      };
    }
  } catch {
    // keep baseline pythia
  }

  // Apolo call (uses Pythia's possibly-LLM output)
  let apolo: ApoloOutput = baseline.apolo;
  try {
    const apoloUser = JSON.stringify({
      market: { upPrice: market.upPrice, downPrice: market.downPrice, spread: market.spread, volume: market.volume },
      pythia,
    });
    const raw = await callLLM(APOLO_SYSTEM, `Inputs:\n${apoloUser}\n\nEmit your decision JSON.`, cfg);
    const parsed = tryParseJson<ApoloJson>(raw);
    if (
      parsed &&
      (parsed.decision === 'UP' || parsed.decision === 'DOWN' || parsed.decision === 'NEUTRAL') &&
      (parsed.status === 'APPROVED' || parsed.status === 'REJECTED')
    ) {
      // Never let LLM raise confidence above Pythia's.
      const conf = clampConfidence(parsed.confidence, pythia.confidence);
      const cappedConf = Math.min(conf, pythia.confidence);
      const risk: 'LOW' | 'MEDIUM' | 'HIGH' =
        parsed.risk === 'LOW' || parsed.risk === 'MEDIUM' || parsed.risk === 'HIGH'
          ? parsed.risk
          : cappedConf >= 70 ? 'LOW' : cappedConf >= 58 ? 'MEDIUM' : 'HIGH';
      apolo = {
        decision: parsed.decision,
        status: parsed.status,
        confidence: cappedConf,
        risk,
        reason: parsed.reasoning?.slice(0, 280) || baseline.apolo.reason,
        reasoning: parsed.reasoning?.slice(0, 280),
      };
    }
  } catch {
    // keep baseline apolo
  }

  // Recompute Hermes from the (possibly LLM-influenced) Apolo decision.
  const approved = apolo.status === 'APPROVED' && apolo.decision !== 'NEUTRAL';
  const action: HermesAction = !approved ? 'SKIP' : apolo.decision === 'UP' ? 'BUY_UP' : 'BUY_DOWN';
  const hermes: HermesOutput = {
    action,
    sizeUsdc: approved ? '0.10' : '0.00',
    mode: 'DRY_RUN',
  };

  return { market, pythia, apolo, hermes, reasoningMode: 'llm' };
}

/**
 * Top-level entry point. Picks deterministic vs llm based on env flag.
 * Always returns a valid signal — LLM failures degrade to deterministic.
 */
export async function deriveSignal(market: MarketSnapshot, mode?: ReasoningMode): Promise<DerivedSignal> {
  const m: ReasoningMode =
    mode || (process.env.A2A_REASONING_MODE === 'llm' ? 'llm' : 'deterministic');
  if (m === 'llm') return deriveSignalLLM(market);
  return deriveSignalDeterministic(market);
}
