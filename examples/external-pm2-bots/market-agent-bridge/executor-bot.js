require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const { callLLM } = require("./shared/llm-client");
const { latestSession, postEvent, postReceipt } = require("./shared/arclayer-client");
const { runForever } = require("./shared/runner");
const { payForBridgeAccess } = require("./shared/x402-client");

function sanitizeIntent(raw, analyzer, evaluator) {
  const approved = Boolean(evaluator?.approved);
  const direction = analyzer?.suggestedDirection || "NEUTRAL";

  if (!approved) {
    return {
      source: raw?.source || "llm-executor",
      action: "SKIP",
      mode: "DRY_RUN",
      reason: evaluator?.reason || "Evaluator did not approve.",
      mockTrade: null,
      safety: {
        realExecution: false,
        privateKeyUsed: false,
        walletPrivateKeyLoaded: Boolean(process.env.WALLET_PRIVATE_KEY || process.env.POLYMARKET_PRIVATE_KEY),
        privateKeyUsedForSigning: false
      }
    };
  }

  const action = raw?.action === "DRY_RUN_ONLY" ? "DRY_RUN_ONLY" : "SKIP";

  return {
    source: raw?.source || "llm-executor",
    action,
    mode: "DRY_RUN",
    reason: String(raw?.reason || "Dry-run execution intent generated."),
    mockTrade: action === "DRY_RUN_ONLY" ? {
      venue: raw?.mockTrade?.venue || "polymarket",
      market: raw?.mockTrade?.market || "BTC 15m UP/DOWN",
      direction,
      entryMode: analyzer?.entryMode || null,
      confidence: analyzer?.confidence || null,
      notionalUsdc: "0.00",
      realExecution: false
    } : null,
    safety: {
      realExecution: false,
      privateKeyUsed: false,
      walletPrivateKeyLoaded: Boolean(process.env.WALLET_PRIVATE_KEY || process.env.POLYMARKET_PRIVATE_KEY),
      privateKeyUsedForSigning: false
    }
  };
}

async function runOnce() {
  const data = await latestSession();
  const session = data.session;

  if (!session?.sessionId) {
    throw new Error("No latest bridge session. Run oracle/analyzer/evaluator first.");
  }

  const analyzerPayloadRaw = session.roles?.analyzer?.payload || {};
  const evaluatorPayload = session.roles?.evaluator?.payload || {};

  const suggestedDirection =
    analyzerPayloadRaw?.suggestedDirection ||
    analyzerPayloadRaw?.signal?.suggestedDirection;

  if (!suggestedDirection) throw new Error("Missing analyzer output.");

  const analyzerPayload = {
    ...analyzerPayloadRaw,
    suggestedDirection,
  };
  if (typeof evaluatorPayload?.approved !== "boolean") throw new Error("Missing evaluator output.");

  const fallback = sanitizeIntent({
    source: "executor-fallback",
    action: evaluatorPayload.approved ? "DRY_RUN_ONLY" : "SKIP",
    reason: evaluatorPayload.approved ? "Fallback generated dry-run intent." : "Evaluator rejected."
  }, analyzerPayload, evaluatorPayload);

  const llm = await callLLM({
    fallback,
    system: `
You are a dry-run execution intent agent.
Return JSON only.
You must never create, sign, or broadcast real transactions.
You can only output DRY_RUN_ONLY or SKIP.
Schema:
{
  "source": "llm-executor",
  "action": "DRY_RUN_ONLY" | "SKIP",
  "mode": "DRY_RUN",
  "reason": string,
  "mockTrade": {
    "venue": string,
    "market": string,
    "direction": "UP" | "DOWN" | "NEUTRAL",
    "notionalUsdc": "0.00",
    "realExecution": false
  } | null
}
`,
    prompt: `
Create the final dry-run intent.

Analyzer:
${JSON.stringify(analyzerPayload).slice(0, 8000)}

Evaluator:
${JSON.stringify(evaluatorPayload).slice(0, 8000)}
`
  });

  const payload = sanitizeIntent(llm, analyzerPayload, evaluatorPayload);

  const posted = await postEvent({
    sessionId: session.sessionId,
    role: "executor",
    type: "execution_intent",
    runtimeId: process.env.RUNTIME_ID || "pm2-llm-executor-bot",
    payload
  });

  await postReceipt({
    sessionId: session.sessionId,
    payloadHash: posted.payloadHash,
    metadata: {
      role: "executor",
      action: payload.action,
      mode: payload.mode,
      eventId: posted.eventId || null
    }
  });

  if (process.env.X402_AUTOPAY === "true") {
    if (process.env.PROTOCOL_TX_MODE !== "ARC_TESTNET") {
      console.log("[x402][executor] skipped: PROTOCOL_TX_MODE must be ARC_TESTNET for x402 autopay.");
      return;
    }
    try {
      const payment = await payForBridgeAccess({
        sessionId: session.sessionId,
        scope: process.env.X402_SCOPE || "external_trace"
      });

      if (!payment.ok) {
        console.log(`[x402][executor] skipped: ${payment.error || payment.message || "unknown"}`);
        if (process.env.X402_AUTOPAY_REQUIRED === "true") throw new Error(payment.error || "x402_autopay_failed");
        return;
      }

      console.log(`[x402][executor] paid bridge access mode=${payment.mode || "n/a"} tx=${payment.transaction || "n/a"} payer=${payment.payer || "n/a"}`);

      await postEvent({
        sessionId: session.sessionId,
        role: "executor",
        type: "receipt_reference",
        runtimeId: process.env.RUNTIME_ID || "pm2-llm-executor-bot",
        payload: {
          source: "x402-autopay",
          resource: "/api/x402/bridge-access",
          scope: process.env.X402_SCOPE || "external_trace",
          payer: payment.payer || null,
          payTo: payment.payTo || null,
          amount: payment.amount || null,
          transaction: payment.txHash || null,
          txHash: payment.txHash || null,
          paymentId: payment.paymentId || null,
          mode: payment.mode || "arc-native",
          unlockedSessionId: payment.sessionId || session.sessionId,
          unlockedPayloadHash: payment.payloadHash || null
        },
        metadata: {
          role: "executor",
          x402Autopay: true,
          eventId: posted.eventId || null
        }
      });
      await postReceipt({
        sessionId: session.sessionId,
        payloadHash: posted.payloadHash,
        metadata: {
          role: "executor",
          type: "x402_payment_proof",
          txHash: payment.txHash || null,
          paymentId: payment.paymentId || null
        }
      });
      await postEvent({
        sessionId: session.sessionId,
        role: "executor",
        type: "x402_paid",
        runtimeId: process.env.RUNTIME_ID || "pm2-llm-executor-bot",
        payload: {
          source: "x402-autopay",
          txHash: payment.txHash || null,
          paymentId: payment.paymentId || null,
          mode: payment.mode || "arc-native"
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err && typeof err === "object" ? err.code : null;
      const detail = err && typeof err === "object" ? err.detail : null;
      if (code === "rail_session_not_found") {
        console.error(`[x402] autopay rail_session_not_found sessionId=${detail?.sessionId || session.sessionId} scope=${detail?.scope || "external_trace"} reason=${detail?.reason || "unknown"}`);
        if (process.env.X402_AUTOPAY_REQUIRED !== "true") return;
      }
      console.error(`[x402] autopay failed: ${message}`);
      if (process.env.X402_AUTOPAY_REQUIRED === "true") throw err;
    }
  }
}

runForever("executor", runOnce).catch((err) => {
  console.error(`[executor] fatal: ${err.message}`);
  process.exitCode = 1;
});
