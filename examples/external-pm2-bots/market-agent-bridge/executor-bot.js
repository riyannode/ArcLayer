const { loadRoleEnv } = require("./shared/env-loader");
loadRoleEnv("executor");
const { latestSession, postEvent, postReceipt, safePostLiveEvent, sha256 } = require("./shared/arclayer-client");
const { runForever } = require("./shared/runner");
const { payForBridgeAccess } = require("./shared/x402-client");

async function runOnce() {
  // Event graph: executor reads from analyzer (fallback: evaluator)
  let data;
  try {
    data = await latestSession({ requiredRoles: ['analyzer'] });
    if (!data?.session?.sessionId) throw new Error('no analyzer session');
    console.log('[executor] reading from analyzer');
  } catch {
    data = await latestSession({ requiredRoles: ['evaluator'] });
    if (!data?.session?.sessionId) {
      console.log('[executor] skip reason=no_analyzer_or_evaluator_session');
      return;
    }
    console.log('[executor] fallback: reading from evaluator');
  }
  const session = data.session;

  const upstreamPayload = session.roles?.analyzer?.payload || session.roles?.evaluator?.payload;
  if (!upstreamPayload) {
    console.log('[executor] skip reason=no_upstream_payload');
    return;
  }

  // Freshness check — skip session lama (>10 menit)
  const upstreamTs = session.roles?.analyzer?.timestamp || session.roles?.evaluator?.timestamp || 0;
  const ageMin = upstreamTs ? (Date.now() - new Date(upstreamTs).getTime()) / 60000 : 999;
  if (ageMin > 10) {
    console.log(`[executor] skip session=${session.sessionId} reason=stale_upstream age=${ageMin.toFixed(1)}m`);
    return;
  }

  // Prefer evaluator for approval (has `approved` field, analyzer doesn't)
  // Use analyzer for signal/direction data (has technical analysis)
  const evalPayload = session.roles?.evaluator?.payload;
  const signalPayload = session.roles?.analyzer?.payload || evalPayload;

  const approved = Boolean(evalPayload?.approved);
  const direction = signalPayload?.direction || signalPayload?.suggestedDirection || evalPayload?.direction || 'NEUTRAL';
  const confidence = signalPayload?.confidence || evalPayload?.confidence || 0;

  console.log(`[executor] signal received session=${session.sessionId} approved=${approved} direction=${direction} confidence=${confidence}`);

  // Post execution intent — selalu, apapun hasil evaluator
  const payload = {
    source: 'llm-executor',
    action: approved ? 'EXECUTE' : 'DRY_RUN_ONLY',
    mode: approved ? 'LIVE' : 'DRY_RUN',
    direction,
    confidence,
    reason: approved ? `Approved: ${direction} @ ${confidence}%` : `Rejected: ${evalPayload?.reason || signalPayload?.reason || 'upstream rejected'}`,
    riskLevel: evalPayload?.riskLevel || signalPayload?.riskLevel || 'HIGH',
    flags: evalPayload?.flags || signalPayload?.flags || []
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
      riskLevel: evalPayload?.riskLevel || signalPayload?.riskLevel
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
    summary: `Signal ${direction} @ ${confidence}% — ${approved ? 'approved' : 'rejected'} by upstream`,
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
        const txHash = payment.txHash || payment.transaction || null;
        console.log(`[x402][executor] paid tx=${txHash || 'n/a'} payer=${payment.payer || 'n/a'}`);

        // Persist x402 proof — without this, hasExecutorX402Proof() never
        // returns true and the dedup guard in latestSession() keeps resurfacing
        // the same session every cycle.
        if (txHash) {
          const paymentId = payment.paymentId || null;
          const receiptEventPayload = {
            source: 'x402-autopay',
            scope: 'external_trace',
            role: 'executor',
            txHash,
            transaction: txHash,
            paymentId
          };
          const receiptRef = await postEvent({
            sessionId: session.sessionId,
            role: 'executor',
            type: 'receipt_reference',
            runtimeId: process.env.RUNTIME_ID || 'pm2-llm-executor-bot',
            payload: receiptEventPayload,
            metadata: { source: 'x402-autopay' }
          });
          await postReceipt({
            sessionId: session.sessionId,
            receiptType: 'x402_arc_native',
            payloadHash: sha256(receiptEventPayload),
            metadata: {
              role: 'executor',
              scope: 'external_trace',
              source: 'x402-autopay',
              txHash,
              paymentId,
              bridgePayloadHash: receiptRef.payloadHash,
              protocolTxMode: 'arc_testnet'
            }
          });
          await safePostLiveEvent('x402_paid', {
            sessionId: session.sessionId,
            paymentId,
            bridgePayloadHash: receiptRef.payloadHash,
            txHash,
            amountAtomic: payment.amount || null,
            title: 'Executor x402 paid',
            summary: `Executor external_trace x402 payment settled`,
            trace: ['executor', 'receipt_reference', 'x402_arc_native', 'x402_paid'],
            reasoning: 'executor external_trace x402 autopay'
          });
          console.log(`[x402][executor] proof persisted session=${session.sessionId} tx=${txHash}`);
        }
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
