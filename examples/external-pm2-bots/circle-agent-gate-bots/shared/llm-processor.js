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
  oracle: `You are a prediction market oracle. Your job is to analyze crypto market data and produce a structured market snapshot.

Output ONLY valid JSON with these fields:
{
  "signal": "BULLISH" | "BEARISH" | "NEUTRAL",
  "data": {
    "estimatedPrice": number (BTC price estimate),
    "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
    "keyObservations": string[]
  },
  "summary": "one-line market summary",
  "decision": "PUBLISH_MARKET_DATA",
  "confidence": 0.0 to 1.0
}`,

  analyzer: `You are a prediction market analyzer. You receive oracle market data and produce a trading analysis.

Input: oracle market snapshot with signal and price data.

Output ONLY valid JSON with these fields:
{
  "analysis": {
    "trend": "BULLISH" | "BEARISH" | "SIDEWAYS",
    "keyLevels": { "support": number, "resistance": number },
    "momentumStrength": "STRONG" | "MODERATE" | "WEAK",
    "rationale": string
  },
  "summary": "one-line analysis summary",
  "decision": "BULLISH_SIGNAL" | "BEARISH_SIGNAL" | "NEUTRAL_SIGNAL",
  "confidence": 0.0 to 1.0
}`,

  evaluator: `You are a prediction market risk evaluator. You receive an analyzer's trading signal and assess risk.

Input: analyzer output with trend, key levels, and momentum.

Output ONLY valid JSON with these fields:
{
  "evaluation": {
    "riskLevel": "LOW" | "MEDIUM" | "HIGH" | "EXTREME",
    "preTradeValid": true | false,
    "suggestedSize": string (USDC amount, e.g. "0.5"),
    "riskFactors": string[]
  },
  "summary": "one-line evaluation summary",
  "decision": "APPROVE" | "APPROVE_REDUCED" | "REJECT",
  "confidence": 0.0 to 1.0
}`,

  executor: `You are a prediction market executor. You receive an evaluator's risk assessment and produce an execution order.

Input: evaluator output with risk level and suggested size.

Output ONLY valid JSON with these fields:
{
  "execution": {
    "action": "PLACE_ORDER" | "SKIP",
    "side": "UP" | "DOWN",
    "size": string (USDC amount),
    "limitPrice": number
  },
  "summary": "one-line execution summary",
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
  const content = data?.choices?.[0]?.message?.content;

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
      return `Analyze the current crypto market for ${market}. Provide a market snapshot with signal, price estimate, and sentiment.`;

    case "analyzer":
      return `Analyze this oracle market data and produce a trading signal:\n\n${JSON.stringify(upstreamData, null, 2)}`;

    case "evaluator":
      return `Evaluate the risk of this analyzer trading signal:\n\n${JSON.stringify(upstreamData, null, 2)}`;

    case "executor":
      return `Execute this evaluator risk assessment:\n\n${JSON.stringify(upstreamData, null, 2)}`;

    default:
      return `Process this data for role=${role}:\n\n${JSON.stringify({ upstreamData, config }, null, 2)}`;
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function processWithLlm({ role, upstreamData, config }) {
  const isMock = provider === "mock" || model === "mock-llm" || !apiKey;

  if (!isMock) {
    try {
      const systemPrompt = SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.oracle;
      const userMessage = buildUserMessage(role, upstreamData, config);

      const startMs = Date.now();
      const result = await callJuneApi({ systemPrompt, userMessage, role });
      const latencyMs = Date.now() - startMs;

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
