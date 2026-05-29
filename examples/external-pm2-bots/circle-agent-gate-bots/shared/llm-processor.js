/**
 * LLM processor — calls June API (api.blockchain.info) for real LLM inference.
 *
 * Falls back to mock per-role if LLM_PROVIDER="mock" or call fails.
 *
 * Output shape per role:
 *   oracle:     { signal, data, summary, decision, provider, model }
 *   analyzer:   { analysis, summary, decision, confidence, provider, model }
 *   evaluator:  { evaluation, summary, decision, confidence, provider, model }
 *   executor:   { execution, summary, decision, confidence, provider, model }
 */

const provider = process.env.LLM_PROVIDER || "june";
const model = process.env.LLM_MODEL || "mock-llm";
const apiKey = process.env.LLM_API_KEY || "";
const baseUrl = process.env.LLM_BASE_URL || "https://api.blockchain.info/ai/api/v1";

// ── Role system prompts ──────────────────────────────────────────

const SYSTEM_PROMPTS = {
  oracle: `You are a prediction market ORACLE — the primary data source for the entire pipeline.

Your PERSONALITY: You are a macro-market observer. You focus on broad market sentiment, on-chain metrics, funding rates, and macroeconomic signals. You do NOT do technical analysis or risk assessment — that's for downstream bots.

Your ONLY job is to produce raw market data snapshots that other bots consume.

Output ONLY valid JSON with these fields:
{
  "signal": "BULLISH" | "BEARISH" | "NEUTRAL",
  "data": {
    "estimatedPrice": number (BTC price estimate),
    "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
    "fundingRate": number or null,
    "volume24h": number or null,
    "keyObservations": string[]
  },
  "summary": "one-line market snapshot",
  "decision": "PUBLISH_MARKET_DATA",
  "confidence": 0.0 to 1.0
}`,

  analyzer: `You are a TECHNICAL ANALYZER in a prediction market pipeline.

Your PERSONALITY: You are a chart-focused technical analyst. You specialize in price action, support/resistance levels, trend lines, momentum indicators (RSI, MACD), and volume analysis. You are precise, data-driven, and conservative in your signals.

Your job: Receive oracle market data and produce a detailed technical analysis.

CRITICAL: You MUST receive upstream oracle data to function. If no oracle data is provided, you CANNOT produce analysis — return an error status.

Output ONLY valid JSON with these fields:
{
  "analysis": {
    "trend": "BULLISH" | "BEARISH" | "SIDEWAYS",
    "keyLevels": { "support": number, "resistance": number },
    "momentumStrength": "STRONG" | "MODERATE" | "WEAK",
    "indicators": { "rsi": string, "macd": string, "volume": string },
    "rationale": string
  },
  "summary": "one-line technical analysis",
  "decision": "BULLISH_SIGNAL" | "BEARISH_SIGNAL" | "NEUTRAL_SIGNAL",
  "confidence": 0.0 to 1.0
}`,

  evaluator: `You are a RISK EVALUATOR in a prediction market pipeline.

Your PERSONALITY: You are a risk manager. You focus on downside protection, position sizing, risk-reward ratios, and capital preservation. You are cautious, always consider worst-case scenarios, and prioritize protecting capital over maximizing gains.

Your job: Receive oracle market data and produce a comprehensive risk evaluation.

CRITICAL: You MUST receive upstream oracle data to function. If no oracle data is provided, you CANNOT produce evaluation — return an error status.

Output ONLY valid JSON with these fields:
{
  "evaluation": {
    "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "EXTREME",
    "preTradeValid": true | false,
    "suggestedSize": string (USDC amount, e.g. "0.5"),
    "riskRewardRatio": string (e.g. "1:2.5"),
    "stopLoss": number or null,
    "riskFactors": string[],
    "rationale": string
  },
  "summary": "one-line risk evaluation",
  "decision": "APPROVE" | "APPROVE_REDUCED" | "REJECT",
  "confidence": 0.0 to 1.0
}`,

  executor: `You are an EXECUTION STRATEGIST in a prediction market pipeline.

Your PERSONALITY: You are an execution specialist. You focus on optimal entry/exit timing, order types, slippage management, and trade execution efficiency. You are decisive, action-oriented, and focus on getting the best fill price.

Your job: Receive analysis (from analyzer) and/or risk evaluation (from evaluator) and produce a concrete execution order.

CRITICAL: You MUST receive upstream data from analyzer OR evaluator to function. If neither is provided, you CANNOT produce execution — return an error status.

Output ONLY valid JSON with these fields:
{
  "execution": {
    "action": "PLACE_ORDER" | "SKIP",
    "side": "UP" | "DOWN",
    "size": string (USDC amount),
    "limitPrice": number,
    "orderType": "LIMIT" | "MARKET",
    "urgency": "IMMEDIATE" | "PATIENT" | "WAIT",
    "rationale": string
  },
  "summary": "one-line execution decision",
  "decision": "EXECUTE_UP" | "EXECUTE_DOWN" | "SKIP",
  "confidence": 0.0 to 1.0
}`,
};

// ── Real LLM call (June API — OpenAI-compatible) ─────────────────

async function callJuneApi({ systemPrompt, userMessage, role }) {
  if (!apiKey) throw new Error("Missing LLM_API_KEY");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 800,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "unknown");
    throw new Error(`June API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const msg = data?.choices?.[0]?.message;
  // Reasoning models (qwen, kimi, deepseek-v4-pro) put output in `reasoning`,
  // non-reasoning models (gemini-flash, deepseek-v4-flash, claude) put it in `content`.
  const reasoning = msg?.reasoning || null;
  const content = msg?.content || reasoning;

  // Log reasoning if present
  if (reasoning) {
    const preview = typeof reasoning === 'string' ? reasoning.slice(0, 300) : JSON.stringify(reasoning).slice(0, 300);
    console.log(`[llm:${role}] reasoning: ${preview}${reasoning.length > 300 ? '...' : ''}`);
  }

  if (!content) {
    throw new Error("June API returned empty response");
  }

  // Parse JSON from response
  try {
    return JSON.parse(content);
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      return JSON.parse(match[1].trim());
    }
    throw new Error(`Failed to parse LLM response as JSON: ${content.slice(0, 100)}`);
  }
}

// ── Mock fallbacks ───────────────────────────────────────────────

function mockOracle(config) {
  return {
    signal: "NEUTRAL",
    data: {
      estimatedPrice: 87450,
      sentiment: "NEUTRAL",
      keyObservations: ["Mock oracle — no LLM configured"],
    },
    summary: `Oracle published market snapshot for ${config.market}.`,
    decision: "PUBLISH_MARKET_DATA",
    confidence: 0.5,
    provider: "mock",
    model: "mock-llm",
  };
}

function mockAnalyzer(upstreamData) {
  return {
    analysis: {
      trend: "SIDEWAYS",
      keyLevels: { support: 86500, resistance: 88500 },
      momentumStrength: "WEAK",
      rationale: "Mock analyzer — no LLM configured",
    },
    summary: "Analyzer processed oracle data (mock).",
    decision: "NEUTRAL_SIGNAL",
    confidence: 0.5,
    provider: "mock",
    model: "mock-llm",
  };
}

function mockEvaluator(upstreamData) {
  return {
    evaluation: {
      riskLevel: "MEDIUM",
      preTradeValid: true,
      suggestedSize: "0.5",
      riskFactors: ["Mock evaluator — no LLM configured"],
    },
    summary: "Evaluator assessed risk (mock).",
    decision: "APPROVE_REDUCED",
    confidence: 0.5,
    provider: "mock",
    model: "mock-llm",
  };
}

function mockExecutor(upstreamData) {
  return {
    execution: {
      action: "SKIP",
      side: "UP",
      size: "0",
      limitPrice: 0,
    },
    summary: "Executor skipped — mock mode.",
    decision: "SKIP",
    confidence: 0.5,
    provider: "mock",
    model: "mock-llm",
  };
}

// ── Build prompt from role + upstream data ───────────────────────

function buildUserMessage(role, upstreamData, config) {
  const market = config?.market || "btc-15m";

  switch (role) {
    case "oracle":
      return `Analyze the current crypto market for ${market}. Provide a market snapshot with signal, price estimate, sentiment, funding rate, and volume.`;

    case "analyzer":
      if (!upstreamData) {
        throw new Error("[analyzer] BLOCKED: No oracle data available. Analyzer requires oracle market data to function.");
      }
      return `Analyze this oracle market data. Produce a detailed technical analysis with trend, key levels, momentum indicators, and rationale:\n\n${JSON.stringify(upstreamData, null, 2)}`;

    case "evaluator":
      if (!upstreamData) {
        throw new Error("[evaluator] BLOCKED: No oracle data available. Evaluator requires oracle market data to function.");
      }
      return `Evaluate the risk of this oracle market data. Produce a comprehensive risk evaluation with risk level, position sizing, risk-reward ratio, stop loss, and risk factors:\n\n${JSON.stringify(upstreamData, null, 2)}`;

    case "executor":
      if (!upstreamData) {
        throw new Error("[executor] BLOCKED: No analyzer or evaluator data available. Executor requires upstream analysis to function.");
      }
      return `Execute based on this upstream analysis/evaluation. Produce a concrete execution order with action, side, size, limit price, order type, and urgency:\n\n${JSON.stringify(upstreamData, null, 2)}`;

    default:
      return `Process this data for role=${role}:\n\n${JSON.stringify({ upstreamData, config }, null, 2)}`;
  }
}

// ── Build system prompt with upstream context injection ─────────

function buildSystemPrompt(role, upstreamData) {
  const base = SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.oracle;

  if (role === "oracle") {
    return base; // Oracle has no upstream context
  }

  if (!upstreamData) {
    // Blocking roles without data — still return prompt but user message will throw
    return base;
  }

  const contextLabel = role === "analyzer" || role === "evaluator"
    ? "Oracle market data you MUST analyze:"
    : role === "executor"
      ? "Upstream analysis/evaluation you MUST execute on:"
      : "Upstream data:";

  return `${base}\n\n--- ${contextLabel} ---\n${JSON.stringify(upstreamData).slice(0, 3000)}`;
}

// ── Main ─────────────────────────────────────────────────────────

async function processWithLlm({ role, upstreamData, config }) {
  const isMock = provider === "mock" || model === "mock-llm" || !apiKey || provider === "none";

  if (!isMock) {
    try {
      const systemPrompt = buildSystemPrompt(role, upstreamData);
      const userMessage = buildUserMessage(role, upstreamData, config);

      const startMs = Date.now();
      console.log(`[llm:${role}] calling ${provider} model=${model}`);
      const result = await callJuneApi({ systemPrompt, userMessage, role });
      const latencyMs = Date.now() - startMs;
      console.log(`[llm:${role}] OK in ${latencyMs}ms`);

      return {
        ...result,
        provider,
        model,
        latencyMs,
      };
    } catch (err) {
      console.warn(`[llm-processor] ${role} LLM call failed, falling back to mock: ${err.message}`);
      // Fall through to mock
    }
  }

  // Mock fallback
  switch (role) {
    case "oracle":   return mockOracle(config);
    case "analyzer": return mockAnalyzer(upstreamData);
    case "evaluator":return mockEvaluator(upstreamData);
    case "executor": return mockExecutor(upstreamData);
    default:         return { summary: `Unknown role=${role}`, decision: "UNKNOWN", confidence: 0.5, provider: "mock", model: "mock-llm" };
  }
}

module.exports = {
  processWithLlm,
};
