const { loadRoleEnv } = require("./shared/env-loader");
loadRoleEnv("analyzer");

const { callLLM } = require("./shared/llm-client");
const { hasRoleContentEvent, latestSession, postEvent, postReceipt } = require("./shared/arclayer-client");
const { bpsSignal, clamp } = require("./shared/market-logic");
const { runForever } = require("./shared/runner");
const { payForBridgeAccess } = require("./shared/x402-client");
const { acquireRoleLock, releaseRoleLock } = require("./shared/role-lock");

function sanitizeAnalysis(raw, fallbackSignal) {
  const allowed = new Set(["UP", "DOWN", "NEUTRAL"]);
  const direction = allowed.has(raw?.suggestedDirection) ? raw.suggestedDirection : fallbackSignal.suggestedDirection;
  const confidence = clamp(Number(raw?.confidence ?? fallbackSignal.confidence), 0, 95);

  return {
    source: raw?.source || "llm-analyzer",
    suggestedDirection: direction,
    confidence,
    entryMode: raw?.entryMode || fallbackSignal.entryMode,
    regime: raw?.regime || fallbackSignal.regime,
    summary: String(raw?.summary || `BPS analysis suggests ${direction} with confidence ${confidence}.`),
    rationale: Array.isArray(raw?.rationale) ? raw.rationale.slice(0, 8) : [
      "BPS threshold and microstructure signal evaluated.",
      "Orderbook spread, depth, and candle momentum checked."
    ],
    noTradeReason: raw?.noTradeReason || (direction === "NEUTRAL" ? "No clear directional edge." : null),
    riskFlags: Array.from(new Set([...(fallbackSignal.riskFlags || []), ...((Array.isArray(raw?.riskFlags) ? raw.riskFlags : []))])),
    signal: fallbackSignal
  };
}

async function runOnce() {
  const data = await latestSession({ requiredRoles: ['oracle'] });
  const session = data.session;

  if (!session?.sessionId) {
    console.log("[analyzer] skip reason=no_oracle_session");
    return;
  }

  // Acquire role lock — atomic filesystem lock prevents concurrent
  // analyzer processes from processing the same session.
  let rlp = acquireRoleLock(session.sessionId, 'analyzer');
  if (!rlp) {
    console.log(`[analyzer] lock_exists session=${session.sessionId} role=analyzer, skip`);
    return;
  }
  try {
    // Skip if analyzer already processed this session (API-based guard)
    if (hasRoleContentEvent({ sessionId: session.sessionId, events: session.events, role: 'analyzer', type: 'resolver_output' })) {
      console.log(`[analyzer] skip session=${session.sessionId} reason=role_already_processed`);
      return;
    }

  const oraclePayload = session.roles?.oracle?.payload || {};
  const raw = oraclePayload.raw || oraclePayload;
  const fallbackSignal = bpsSignal({
    market: raw.market || {},
    orderbook: raw.orderbook || {},
    candles: raw.candles || {}
  });

  const fallback = sanitizeAnalysis({
    source: "analyzer-fallback",
    suggestedDirection: fallbackSignal.suggestedDirection,
    confidence: fallbackSignal.confidence,
    entryMode: fallbackSignal.entryMode,
    regime: fallbackSignal.regime,
    summary: `Fallback BPS analysis: ${fallbackSignal.suggestedDirection}, confidence=${fallbackSignal.confidence}.`,
    rationale: [
      `marketEdgeBps=${fallbackSignal.edge.marketEdgeBps}`,
      `momentumBps=${fallbackSignal.edge.momentumBps}`,
      `spreadBps=${fallbackSignal.book.spreadBps}`,
      `depthUsdc=${fallbackSignal.book.depthUsdc}`
    ],
    noTradeReason: fallbackSignal.suggestedDirection === "NEUTRAL" ? "No clear edge from price and momentum." : null,
    riskFlags: fallbackSignal.riskFlags
  }, fallbackSignal);

  const llm = await callLLM({
    fallback,
    system: `
You are an autonomous prediction-market analyst.
Return JSON only.
Never reveal secrets.
Never output real transaction instructions.
Use the BPS signal, candle momentum, book spread, depth, and imbalance.
Schema:
{
  "source": "llm-analyzer",
  "suggestedDirection": "UP" | "DOWN" | "NEUTRAL",
  "confidence": number,
  "entryMode": "momentum" | "sideway_micro_scalp",
  "regime": "NORMAL" | "BREAKOUT",
  "summary": string,
  "rationale": string[],
  "riskFlags": string[],
  "noTradeReason": string | null
}
`,
    prompt: `
Analyze the latest external oracle session.

BPS / microstructure signal:
${JSON.stringify(fallbackSignal)}

Oracle payload:
${JSON.stringify(oraclePayload).slice(0, 12000)}
`
  });

  const payload = sanitizeAnalysis(llm, fallbackSignal);

  const posted = await postEvent({
    sessionId: session.sessionId,
    role: "analyzer",
    type: "resolver_output",
    runtimeId: process.env.RUNTIME_ID || "pm2-llm-analyzer-bot",
    payload
  });

  if (posted.deduped) {
    console.log(`[analyzer] deduped content event session=${session.sessionId}, skip downstream`);
    return;
  }

  await postReceipt({
    sessionId: session.sessionId,
    payloadHash: posted.payloadHash,
    metadata: {
      role: "analyzer",
      eventType: "resolver_output",
      eventId: posted.eventId || null
    }
  });

  if (process.env.X402_AUTOPAY === "true") {
    try {
      const payment = await payForBridgeAccess({
        sessionId: session.sessionId,
        scope: process.env.X402_SCOPE || "summary",
        role: "analyzer"
      });

      if (!payment.ok) {
        console.log(`[x402][analyzer] skipped: ${payment.error || payment.message || "unknown"}`);
        if (process.env.X402_AUTOPAY_REQUIRED === "true") throw new Error(payment.error || "x402_autopay_failed");
        return;
      }

      console.log(`[x402][analyzer] paid bridge access tx=${payment.transaction || "n/a"} payer=${payment.payer || "n/a"}`);

      await postEvent({
        sessionId: session.sessionId,
        role: "analyzer",
        type: "receipt_reference",
        runtimeId: process.env.RUNTIME_ID || "pm2-llm-analyzer-bot",
        payload: {
          source: "x402-autopay",
          paidByRole: "analyzer",
          resource: "/api/x402/bridge-access",
          scope: process.env.X402_SCOPE || "summary",
          payer: payment.payer || null,
          payTo: payment.payTo || null,
          amount: payment.amount || null,
          transaction: payment.transaction || null,
          paymentId: payment.paymentId || null,
          mode: payment.mode || "arc-native",
          unlockedSessionId: payment.sessionId || session.sessionId,
          unlockedPayloadHash: payment.payloadHash || null,
          eventId: posted.eventId || null
        },
        metadata: {
          role: "analyzer",
          x402Autopay: true,
          paidAfterEventId: posted.eventId || null
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[x402][analyzer] autopay failed: ${message}`);
      if (process.env.X402_AUTOPAY_REQUIRED === "true") throw err;
    }
  }
} finally {
    releaseRoleLock(rlp);
  }
}

runForever("analyzer", runOnce).catch((err) => {
  console.error(`[analyzer] fatal: ${err.message}`);
  process.exitCode = 1;
});
