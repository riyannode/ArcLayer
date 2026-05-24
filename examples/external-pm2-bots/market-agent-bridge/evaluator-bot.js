require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

const { callLLM } = require("./shared/llm-client");
const { hasRoleContentEvent, latestSession, postEvent, postReceipt } = require("./shared/arclayer-client");
const { evaluateRisk } = require("./shared/market-logic");
const { runForever } = require("./shared/runner");
const { payForBridgeAccess } = require("./shared/x402-client");

function sanitizeEvaluation(raw, deterministic) {
  const approved = Boolean(raw?.approved) && deterministic.approved;
  const riskLevelAllowed = new Set(["LOW", "MEDIUM", "HIGH"]);
  const riskLevel = riskLevelAllowed.has(raw?.riskLevel) ? raw.riskLevel : deterministic.riskLevel;

  return {
    source: raw?.source || "llm-evaluator",
    approved,
    riskLevel: approved ? riskLevel : "HIGH",
    reason: String(raw?.reason || (approved ? "Approved for dry-run intent only." : "Rejected by deterministic risk gates.")),
    maxNotionalUsdc: "0.00",
    checks: Array.from(new Set([...(deterministic.checks || []), ...((Array.isArray(raw?.checks) ? raw.checks : []))])),
    flags: Array.from(new Set([...(deterministic.flags || []), ...((Array.isArray(raw?.flags) ? raw.flags : []))])),
    safety: {
      dryRunOnly: true,
      realExecutionAllowed: false,
      privateKeyUsed: false
    }
  };
}

async function runOnce() {
  const data = await latestSession({ requiredRoles: ['analyzer'] });
  const session = data.session;

  if (!session?.sessionId) {
    throw new Error("No latest bridge session. Run oracle/analyzer first.");
  }

  // Skip if evaluator already processed this session
  if (hasRoleContentEvent({ sessionId: session.sessionId, events: session.events, role: 'evaluator', type: 'evaluation' })) {
    console.log(`[evaluator] skip session=${session.sessionId} reason=role_already_processed`);
    return;
  }

  const oraclePayload = session.roles?.oracle?.payload || {};
  const analyzerPayload = session.roles?.analyzer?.payload || {};

  if (!analyzerPayload?.suggestedDirection) {
    throw new Error("Missing analyzer output. Run analyzer first.");
  }

  const deterministic = evaluateRisk({ analyzerPayload, oraclePayload });
  const fallback = sanitizeEvaluation({
    source: "evaluator-fallback",
    approved: deterministic.approved,
    riskLevel: deterministic.riskLevel,
    reason: deterministic.approved ? "Fallback approved dry-run intent only." : `Fallback rejected: ${deterministic.flags.join(", ")}`,
    checks: deterministic.checks,
    flags: deterministic.flags
  }, deterministic);

  const llm = await callLLM({
    fallback,
    system: `
You are an autonomous risk evaluator.
Return JSON only.
You may approve DRY_RUN intent only.
You must never approve real execution.
Respect deterministic risk gates; if any hard gate blocks, approved must be false.
Schema:
{
  "source": "llm-evaluator",
  "approved": boolean,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "reason": string,
  "checks": string[],
  "flags": string[]
}
`,
    prompt: `
Evaluate this analyzer output and deterministic risk gate result.

Deterministic risk:
${JSON.stringify(deterministic)}

Analyzer:
${JSON.stringify(analyzerPayload).slice(0, 10000)}

Oracle:
${JSON.stringify(oraclePayload).slice(0, 8000)}
`
  });

  const payload = sanitizeEvaluation(llm, deterministic);

  const posted = await postEvent({
    sessionId: session.sessionId,
    role: "evaluator",
    type: "evaluation",
    runtimeId: process.env.RUNTIME_ID || "pm2-llm-evaluator-bot",
    payload
  });

  await postReceipt({
    sessionId: session.sessionId,
    payloadHash: posted.payloadHash,
    metadata: {
      role: "evaluator",
      eventType: "evaluation",
      eventId: posted.eventId || null
    }
  });

  if (process.env.X402_AUTOPAY === "true") {
    try {
      const payment = await payForBridgeAccess({
        sessionId: session.sessionId,
        scope: process.env.X402_SCOPE || "receipts",
        role: "evaluator"
      });

      if (!payment.ok) {
        console.log(`[x402][evaluator] skipped: ${payment.error || payment.message || "unknown"}`);
        if (process.env.X402_AUTOPAY_REQUIRED === "true") throw new Error(payment.error || "x402_autopay_failed");
        return;
      }

      console.log(`[x402][evaluator] paid bridge access tx=${payment.transaction || "n/a"} payer=${payment.payer || "n/a"}`);

      await postEvent({
        sessionId: session.sessionId,
        role: "evaluator",
        type: "receipt_reference",
        runtimeId: process.env.RUNTIME_ID || "pm2-llm-evaluator-bot",
        payload: {
          source: "x402-autopay",
          paidByRole: "evaluator",
          resource: "/api/x402/bridge-access",
          scope: process.env.X402_SCOPE || "receipts",
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
          role: "evaluator",
          x402Autopay: true,
          paidAfterEventId: posted.eventId || null
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[x402][evaluator] autopay failed: ${message}`);
      if (process.env.X402_AUTOPAY_REQUIRED === "true") throw err;
    }
  }
}

runForever("evaluator", runOnce).catch((err) => {
  console.error(`[evaluator] fatal: ${err.message}`);
  process.exitCode = 1;
});
