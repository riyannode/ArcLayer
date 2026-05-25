const { loadRoleEnv } = require("./shared/env-loader");
loadRoleEnv("oracle");

const { callLLM } = require("./shared/llm-client");
const { currentSessionId, getJson, postEvent, postReceipt } = require("./shared/arclayer-client");
const { bpsSignal } = require("./shared/market-logic");
const { runForever } = require("./shared/runner");

async function runOnce() {
  const [market, orderbook, candles] = await Promise.all([
    getJson("/api/data/polymarket/btc-15m"),
    getJson("/api/data/polymarket/btc-15m/orderbook"),
    getJson("/api/data/polymarket/btc-15m/candles")
  ]);

  const rawPayload = {
    market,
    orderbook: {
      source: orderbook.source,
      marketSlug: orderbook.marketSlug,
      mid: orderbook.mid,
      bestBid: orderbook.bids?.[0] || orderbook.bestBid || null,
      bestAsk: orderbook.asks?.[0] || orderbook.bestAsk || null,
      bidsCount: orderbook.bids?.length || 0,
      asksCount: orderbook.asks?.length || 0,
      payloadHash: orderbook.payloadHash
    },
    candles: {
      source: candles.source,
      livePrice: candles.livePrice,
      count: candles.candles?.length || 0,
      latest: candles.candles?.at?.(-1) || candles.latest || null,
      candles: Array.isArray(candles.candles) ? candles.candles.slice(-20) : [],
      payloadHash: candles.payloadHash
    }
  };

  const signalPreview = bpsSignal(rawPayload);

  const llmSummary = await callLLM({
    fallback: {
      source: "oracle-fallback",
      summary: "Oracle fetched market, orderbook, and candle data.",
      observations: [
        `asset=${signalPreview.asset}`,
        `directionPreview=${signalPreview.suggestedDirection}`,
        `confidencePreview=${signalPreview.confidence}`
      ]
    },
    system: `
You are an external market-data oracle summarizer.
Return JSON only.
Do not produce trade execution instructions.
Schema:
{
  "source": "llm-oracle",
  "summary": string,
  "observations": string[]
}`,
    prompt: `
Summarize this raw BTC 15m market payload for downstream autonomous agents.

Signal preview:
${JSON.stringify(signalPreview)}

Raw payload:
${JSON.stringify(rawPayload).slice(0, 12000)}
`
  });

  const payload = {
    role: "oracle",
    asset: process.env.ASSET || "BTC",
    raw: rawPayload,
    signalPreview,
    llmSummary
  };

  const posted = await postEvent({
    sessionId: currentSessionId(),
    role: "oracle",
    type: "market_snapshot",
    runtimeId: process.env.RUNTIME_ID || "pm2-llm-oracle-bot",
    payload
  });

  await postReceipt({
    sessionId: posted.sessionId,
    payloadHash: posted.payloadHash,
    metadata: {
      role: "oracle",
      eventType: "market_snapshot",
      eventId: posted.eventId || null
    }
  });
}

runForever("oracle", runOnce).catch((err) => {
  console.error(`[oracle] fatal: ${err.message}`);
  process.exitCode = 1;
});
