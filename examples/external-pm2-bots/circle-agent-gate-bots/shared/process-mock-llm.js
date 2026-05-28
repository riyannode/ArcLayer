/**
 * Mock LLM processor — pluggable.
 *
 * Each bot runs its own LLM logic independently:
 * - Oracle: generates raw market data signal
 * - Analyzer: processes oracle data into analysis
 * - Evaluator: evaluates analyzer output, produces confidence + decision
 * - Executor: takes evaluator output, decides execution action
 *
 * Replace with real LLM call (OpenAI, Anthropic, local model) in production.
 */
function processWithMockLlm({ role, upstreamData, config }) {
  const provider = process.env.LLM_PROVIDER || "mock";
  const model = process.env.LLM_MODEL || "mock-llm";
  const startMs = Date.now();

  const outputs = {
    oracle: {
      decision: "SIGNAL_READY",
      confidence: 0.85,
      summary: "Oracle generated raw market data: BTC 15m OHLCV snapshot with order book depth.",
      signal: {
        asset: config.market || "btc-15m",
        price: 67250 + Math.random() * 500,
        volume: 120 + Math.random() * 80,
        timestamp: new Date().toISOString(),
      },
    },
    analyzer: {
      decision: "ANALYSIS_READY",
      confidence: 0.78,
      summary: upstreamData
        ? `Analyzer processed oracle signal: ${JSON.stringify(upstreamData.signal || upstreamData).slice(0, 100)}`
        : "Analyzer ran with no upstream data — using defaults.",
      analysis: {
        trend: Math.random() > 0.5 ? "bullish" : "bearish",
        strength: Math.round(Math.random() * 100),
        supportLevel: 66800 + Math.random() * 200,
        resistanceLevel: 67500 + Math.random() * 200,
        volumeProfile: "increasing",
      },
    },
    evaluator: {
      decision: Math.random() > 0.3 ? "APPROVE" : "REJECT",
      confidence: Math.random() > 0.3 ? 0.72 : 0.35,
      summary: upstreamData
        ? `Evaluator assessed analysis: trend=${upstreamData.analysis?.trend || "unknown"}, strength=${upstreamData.analysis?.strength || "?"}`
        : "Evaluator ran with no upstream data.",
      evaluation: {
        signalQuality: Math.round(Math.random() * 100),
        riskScore: Math.round(Math.random() * 100),
        recommendation: Math.random() > 0.5 ? "EXECUTE" : "SKIP",
      },
    },
    executor: {
      decision: Math.random() > 0.4 ? "EXECUTED" : "SKIPPED",
      confidence: 0.68,
      summary: upstreamData?.evaluation?.recommendation === "EXECUTE"
        ? "Executor executed trade based on evaluator signal."
        : "Executor skipped — risk threshold not met.",
      execution: {
        action: upstreamData?.evaluation?.recommendation === "EXECUTE" ? "BUY" : "SKIP",
        size: "0.01",
        price: upstreamData?.signal?.price || 67250,
      },
    },
  };

  const result = outputs[role] || {
    decision: "UNKNOWN",
    confidence: 0.5,
    summary: `Unknown role: ${role}`,
  };

  const latencyMs = Date.now() - startMs;

  return {
    ...result,
    provider,
    model,
    latencyMs,
    riskFlags: [],
  };
}

module.exports = {
  processWithMockLlm,
};
