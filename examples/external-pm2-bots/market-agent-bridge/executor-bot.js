require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const { callLLM } = require("./shared/llm-client");
const { latestSession, postEvent, postReceipt, postLiveEvent, safePostLiveEvent } = require("./shared/arclayer-client");
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

  await safePostLiveEvent({
    category: "prediction-market-bots",
    eventType: payload.action === "SKIP" ? "decision_rejected" : "run_job",
    agentId: "llm-market-executor",
    agentName: "ArcLayer Market Executor",
    title: payload.action === "SKIP" ? "Execution skipped" : "Execution intent generated",
    summary: payload.reason,
    decision: payload.action === "SKIP" ? "rejected" : "success",
    trace: ["tick_feed", "scan", "misprice_detect", "fair_prob_model", "arb_check", "llm_reasoned", "run_job"],
    metadata: {
      status: payload.action === "SKIP" ? "rejected" : "success",
      sessionId: session.sessionId,
      role: "executor",
      reasoning: payload.reason,
      action: payload.action,
      ...(payload.action === "DRY_RUN_ONLY" ? { mockTrade: payload.mockTrade } : {})
    }
  });

  if (process.env.X402_AUTOPAY === "true") {
    try {
      const payment = await payForBridgeAccess({
        sessionId: session.sessionId,
        scope: process.env.X402_SCOPE || "external_trace"
      });

      if (!payment.ok) {
        const message = payment.error || payment.message || "unknown";
        console.log(`[x402][executor] skipped: ${message}`);
        try {
          await postLiveEvent({
            category: "prediction-market-bots",
            eventType: "x402_failed",
            agentId: "llm-market-executor",
            agentName: "ArcLayer Market Executor",
            title: "x402 payment failed",
            summary: message,
            decision: "failed",
            trace: ["tick_feed", "scan", "misprice_detect", "fair_prob_model", "arb_check", "x402_paid"],
            metadata: { status: "failed", sessionId: session.sessionId, role: "executor", error: message }
          });
        } catch (liveEventError) {
          const liveEventMessage = liveEventError instanceof Error ? liveEventError.message : String(liveEventError);
          console.error(`[x402][executor] live event failed: ${liveEventMessage}`);
        }
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
          transaction: payment.transaction || null,
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
      try {
        const tx = payment.transaction || null;
        const shortTx = tx && tx.length > 12 ? `${tx.slice(0, 10)}...${tx.slice(-6)}` : tx;
        await postLiveEvent({
          category: "prediction-market-bots",
          eventType: "x402_paid",
          agentId: "llm-market-executor",
          agentName: "ArcLayer Market Executor",
          title: "x402 payment settled",
          summary: shortTx || "x402 paid",
          txHash: tx,
          amountAtomic: payment.amount || null,
          currency: "USDC",
          decision: "success",
          trace: ["tick_feed", "scan", "misprice_detect", "fair_prob_model", "arb_check", "x402_paid", "llm_reasoned", "run_job"],
          metadata: {
            status: "success",
            sessionId: session.sessionId,
            role: "executor",
            paymentId: payment.paymentId,
            payer: payment.payer,
            payTo: payment.payTo,
            mode: payment.mode,
            reasoning: payload.reason
          }
        });
      } catch (liveEventError) {
        const liveEventMessage = liveEventError instanceof Error ? liveEventError.message : String(liveEventError);
        console.error(`[x402][executor] live event failed: ${liveEventMessage}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[x402] autopay failed: ${message}`);
      try {
        await postLiveEvent({
          category: "prediction-market-bots",
          eventType: "x402_failed",
          agentId: "llm-market-executor",
          agentName: "ArcLayer Market Executor",
          title: "x402 payment failed",
          summary: message,
          decision: "failed",
          trace: ["tick_feed", "scan", "misprice_detect", "fair_prob_model", "arb_check", "x402_paid"],
          metadata: { status: "failed", sessionId: session.sessionId, role: "executor", error: message }
        });
      } catch (liveEventError) {
        const liveEventMessage = liveEventError instanceof Error ? liveEventError.message : String(liveEventError);
        console.error(`[x402][executor] live event failed: ${liveEventMessage}`);
      }
      if (process.env.X402_AUTOPAY_REQUIRED === "true") throw err;
    }
  }
}

runForever("executor", runOnce).catch((err) => {
  console.error(`[executor] fatal: ${err.message}`);
  process.exitCode = 1;
});
