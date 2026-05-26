const { loadRoleEnv } = require("./shared/env-loader");
loadRoleEnv("oracle");

const { callLLM } = require("./shared/llm-client");
const { currentSessionId, getJson, postEvent, postReceipt, safePostLiveEvent, sha256 } = require("./shared/arclayer-client");
const { bpsSignal } = require("./shared/market-logic");
const { runForever } = require("./shared/runner");
const { payForBridgeAccess } = require("./shared/x402-client");

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

  // Compact live event — public UI preview, NOT full rawPayload
  {
    const obs0 = Array.isArray(llmSummary.observations) ? llmSummary.observations[0] : null;
    await safePostLiveEvent("market_snapshot", {
      sessionId: posted.sessionId,
      title: "BTC 15m Snapshot",
      summary: (llmSummary.summary || "Oracle snapshot").slice(0, 200),
      confidence: signalPreview.confidence ?? null,
      decision: signalPreview.suggestedDirection || null,
      trace: ["oracle", "market_snapshot"],
      metadata: {
        sessionId: posted.sessionId,
        role: "oracle",
        source: llmSummary.source || (llmSummary.usedFallback ? "fallback" : "llm"),
        usedFallback: !!llmSummary.usedFallback,
        llmModel: llmSummary.llmModel || null,
        reasoningSummary: (llmSummary.summary || "").slice(0, 100),
        rationalePreview: obs0,
        bridgePayloadHash: posted.payloadHash,
        protocolTxMode: "arc_testnet"
      }
    });
  }

  if (process.env.X402_AUTOPAY === "true") {
    try {
      const sessionId = posted.sessionId;
      const payment = await payForBridgeAccess({
        sessionId,
        scope: process.env.X402_SCOPE || "market_data",
        role: "oracle"
      });
      if (!payment.ok) {
        console.log(`[x402][oracle] skipped: ${payment.error || payment.message || "unknown"}`);
        if (process.env.X402_AUTOPAY_REQUIRED === "true") throw new Error(payment.error || "x402_autopay_failed");
        return;
      }
      console.log(`[x402][oracle] paid bridge access tx=${payment.transaction || "n/a"} payer=${payment.payer || "n/a"}`);
      const txHash = payment.txHash || payment.transaction || null;
      if (!txHash) {
        console.log("[x402][oracle] paid but no tx hash returned; skip live x402_paid mirror");
        return;
      }
      const paymentId = payment.paymentId || null;
      const paidScope = payment.scope || process.env.X402_SCOPE || "market_data";
      const receiptEventPayload = { source: "x402-autopay", scope: paidScope, role: "oracle", txHash, transaction: txHash, paymentId };
      const receiptRef = await postEvent({
        sessionId,
        role: "oracle",
        type: "receipt_reference",
        runtimeId: process.env.RUNTIME_ID || "pm2-llm-oracle-bot",
        payload: receiptEventPayload,
        metadata: { source: "x402-autopay" }
      });
      await postReceipt({
        sessionId,
        receiptType: "x402_arc_native",
        payloadHash: sha256(receiptEventPayload),
        metadata: { role: "oracle", scope: paidScope, source: "x402-autopay", txHash, paymentId, bridgePayloadHash: receiptRef.payloadHash, protocolTxMode: "arc_testnet" }
      });
      const liveResult = await safePostLiveEvent("x402_paid", {
        sessionId,
        paymentId,
        bridgePayloadHash: receiptRef.payloadHash,
        txHash,
        amountAtomic: payment.amount || null,
        title: "Oracle x402 paid",
        summary: `Oracle ${paidScope} x402 payment settled`,
        trace: ["oracle", "receipt_reference", "x402_arc_native", "x402_paid"],
        reasoning: `oracle ${paidScope} x402 autopay`
      });
      if (!liveResult.ok) throw new Error(liveResult.message || liveResult.error || "live_event_failed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[x402][oracle] autopay failed: ${message}`);
      if (process.env.X402_AUTOPAY_REQUIRED === "true") throw err;
    }
  }
}

runForever("oracle", runOnce).catch((err) => {
  console.error(`[oracle] fatal: ${err.message}`);
  process.exitCode = 1;
});
