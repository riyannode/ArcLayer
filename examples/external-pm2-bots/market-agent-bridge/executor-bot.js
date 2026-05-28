const { loadRoleEnv } = require("./shared/env-loader");
loadRoleEnv("executor");
const { latestSession, postEvent, postReceipt, safePostLiveEvent, sha256 } = require("./shared/arclayer-client");
const { runForever } = require("./shared/runner");
const { payForBridgeAccess } = require("./shared/x402-client");

async function runOnce() {
  // Executor hanya polling dari evaluator — zero guard
  const { session } = await latestSession({ requiredRoles: ['evaluator'] });
  if (!session?.sessionId) {
    console.log('[executor] skip reason=no_evaluator_session');
    return;
  }

  const evaluatorPayload = session.roles?.evaluator?.payload;
  if (!evaluatorPayload) {
    console.log('[executor] skip reason=no_evaluator_payload');
    return;
  }

  // Freshness check — skip session lama (>10 menit)
  const evaluatorTs = session.roles?.evaluator?.timestamp || 0;
  const ageMin = evaluatorTs ? (Date.now() - new Date(evaluatorTs).getTime()) / 60000 : 999;
  if (ageMin > 10) {
    console.log(`[executor] skip session=${session.sessionId} reason=stale_evaluator age=${ageMin.toFixed(1)}m`);
    return;
  }

  const approved = Boolean(evaluatorPayload.approved);
  const direction = evaluatorPayload.direction || evaluatorPayload.suggestedDirection || 'NEUTRAL';
  const confidence = evaluatorPayload.confidence || 0;

  console.log(`[executor] signal received session=${session.sessionId} approved=${approved} direction=${direction} confidence=${confidence}`);

  // Post execution intent — selalu, apapun hasil evaluator
  const payload = {
    source: 'llm-executor',
    action: approved ? 'EXECUTE' : 'DRY_RUN_ONLY',
    mode: approved ? 'LIVE' : 'DRY_RUN',
    direction,
    confidence,
    reason: approved ? `Approved: ${direction} @ ${confidence}%` : `Rejected: ${evaluatorPayload.reason || 'evaluator rejected'}`,
    evaluatorRiskLevel: evaluatorPayload.riskLevel || 'HIGH',
    evaluatorFlags: evaluatorPayload.flags || []
  };

  const posted = await postEvent({
    sessionId: session.sessionId,
    role: 'executor',
    type: 'execution_intent',
    runtimeId: process.env.RUNTIME_ID || 'pm2-llm-executor-bot',
    payload
  });

  if (posted.deduped) {
    console.log(`[executor] deduped session=${session.sessionId}, skip receipt`);
    return;
  }

  // Post receipt — selalu
  await postReceipt({
    sessionId: session.sessionId,
    receiptType: 'x402_arc_native',
    payloadHash: posted.payloadHash,
    metadata: {
      role: 'executor',
      approved,
      direction,
      confidence,
      evaluatorRiskLevel: evaluatorPayload.riskLevel
    }
  });

  console.log(`[executor] receipt posted session=${session.sessionId} approved=${approved}`);

  // Live event
  await safePostLiveEvent('execution_intent', {
    sessionId: session.sessionId,
    approved,
    direction,
    confidence,
    title: `Executor ${approved ? 'EXECUTE' : 'DRY_RUN'}: ${direction}`,
    summary: `Signal ${direction} @ ${confidence}% — ${approved ? 'approved' : 'rejected'} by evaluator`,
    trace: ['executor', 'execution_intent'],
    reasoning: payload.reason
  });

  // x402 payment kalau approved
  if (approved && process.env.X402_AUTOPAY === 'true' && process.env.PROTOCOL_TX_MODE === 'ARC_TESTNET') {
    try {
      const payment = await payForBridgeAccess({
        sessionId: session.sessionId,
        scope: 'external_trace',
        role: 'executor'
      });
      if (payment.ok) {
        console.log(`[x402][executor] paid tx=${payment.txHash || payment.transaction || 'n/a'}`);
      }
    } catch (err) {
      console.error(`[x402][executor] payment failed: ${err.message}`);
    }
  }
}

runForever("executor", runOnce).catch((err) => {
  console.error(`[executor] fatal: ${err.message}`);
  process.exitCode = 1;
});
