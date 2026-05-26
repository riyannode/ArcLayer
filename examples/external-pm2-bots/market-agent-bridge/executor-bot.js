const { loadRoleEnv } = require("./shared/env-loader");
loadRoleEnv("executor");
const fs = require('node:fs');
const path = require('node:path');
const { callLLM } = require("./shared/llm-client");
const { hasRoleContentEvent, latestSession, postEvent, postReceipt, safePostLiveEvent, sha256, getJson, hasExecutorX402EventOnly, hasExecutorX402Proof } = require("./shared/arclayer-client");
const { runForever } = require("./shared/runner");
const { payForBridgeAccess } = require("./shared/x402-client");
const { acquireRoleLock, releaseRoleLock } = require("./shared/role-lock");

async function runOnce() {
  const { session } = await latestSession({ requiredRoles: ['analyzer', 'evaluator'] });
  if (!session?.sessionId) {
    console.log('[executor] skip reason=no_bridge_session');
    return;
  }
  const analyzerPayload = session.roles?.analyzer?.payload;
  const evaluatorPayload = session.roles?.evaluator?.payload;

  // Acquire role lock — atomic filesystem lock prevents concurrent
  // executor processes from processing the same session.
  let rlp = acquireRoleLock(session.sessionId, 'executor');
  if (!rlp) {
    console.log(`[executor] lock_exists session=${session.sessionId} role=executor, skip`);
    return;
  }
  try {
    // Skip if executor already has execution_intent for this session
    if (hasRoleContentEvent({ sessionId: session.sessionId, events: session.events, role: 'executor', type: 'execution_intent' })) {
    console.log(`[executor] skip session=${session.sessionId} reason=role_already_processed`);
    return;
  }
  if (!analyzerPayload) throw new Error('Missing analyzer output.');
  if (!evaluatorPayload) {
    console.log('[executor] skip reason=no_evaluator_output');
    return;
  }
  if (typeof evaluatorPayload.approved !== 'boolean') throw new Error('Invalid evaluator approval shape.');

  const payload = { source: 'llm-executor', action: 'DRY_RUN_ONLY', mode: 'DRY_RUN', reason: evaluatorPayload.approved ? 'Dry-run only' : 'Skipped: evaluator rejected' };
  const posted = await postEvent({ sessionId: session.sessionId, role: 'executor', type: 'execution_intent', runtimeId: process.env.RUNTIME_ID || 'pm2-llm-executor-bot', payload });
  if (posted.deduped) {
    console.log(`[executor] deduped content event session=${session.sessionId}, skip downstream`);
    return;
  }
  await postReceipt({ sessionId: session.sessionId, receiptType: 'x402_arc_native', payloadHash: posted.payloadHash, metadata: { role: 'executor' } });

  if (!evaluatorPayload.approved) return;
  if (process.env.X402_AUTOPAY !== 'true' || process.env.PROTOCOL_TX_MODE !== 'ARC_TESTNET') return;
  const scope = 'external_trace';

  async function payUpstreamRole(upstreamRole) {
    let lp;
    try {
      const SCOPE_LOCK_DIR = require('node:path').resolve(__dirname, '.x402-locks');
      const scopeLp = require('node:path').join(SCOPE_LOCK_DIR, `${session.sessionId}-${scope}-${upstreamRole}.lock`);
      require('node:fs').mkdirSync(SCOPE_LOCK_DIR, { recursive: true });
      try { const fd = require('node:fs').openSync(scopeLp, 'wx'); require('node:fs').closeSync(fd); lp = scopeLp; } catch (err) { if (err && err.code === 'EEXIST') lp = null; else throw err; }
      if (!lp) {
        console.log(`[x402][executor] lock_exists session=${session.sessionId} scope=${scope} role=${upstreamRole}, skip`);
        return;
      }
      // Event-based skip: check if any payment already exists for this role+session
      const preflightEvents = await getJson(`/api/agent-bridge/events?sessionId=${encodeURIComponent(session.sessionId)}&limit=50`, { authenticated: true }).catch(() => ({ events: [] }));
      if (hasExecutorX402EventOnly({ sessionId: session.sessionId, events: preflightEvents.events || [] })) {
        console.log(`[x402][executor] event_exists session=${session.sessionId} role=${upstreamRole}, skip payment`);
        return;
      }
      const payment = await payForBridgeAccess({ sessionId: session.sessionId, scope, role: upstreamRole });
      if (!payment.ok) return;
      if (payment.alreadyPaid) {
        console.log(`[x402][executor] already_paid session=${session.sessionId} role=${upstreamRole} tx=${payment.txHash || payment.transaction || 'n/a'}`);
        const existingEvents = await getJson(`/api/agent-bridge/events?sessionId=${encodeURIComponent(session.sessionId)}&limit=50`, { authenticated: true }).catch(() => ({ events: [] }));
        const existingReceipts = await getJson(`/api/agent-bridge/receipts?sessionId=${encodeURIComponent(session.sessionId)}&limit=50`, { authenticated: true }).catch(() => ({ receipts: [] }));
        const existingLive = await getJson(`/api/a2a/live-events?category=prediction-market-bots&sessionId=${encodeURIComponent(session.sessionId)}&limit=50`, { authenticated: true }).catch(() => ({ events: [] }));
        if (hasExecutorX402Proof({ sessionId: session.sessionId, events: existingEvents.events || [], receipts: existingReceipts.receipts || [], liveEvents: existingLive.events || [] })) {
          console.log(`[x402][executor] proofs already exist for session=${session.sessionId} role=${upstreamRole}, skip repost`);
          return;
        }
      }
      const txHash = payment.txHash || payment.transaction || null;
      const paymentId = payment.paymentId || null;
      const postflightEvents = await getJson(`/api/agent-bridge/events?sessionId=${encodeURIComponent(session.sessionId)}&limit=50`, { authenticated: true }).catch(() => ({ events: [] }));
      if (hasExecutorX402EventOnly({ sessionId: session.sessionId, events: postflightEvents.events || [] })) {
        console.log(`[x402][executor] event_appeared session=${session.sessionId} tx=${txHash} role=${upstreamRole}, skip proof posting`);
        return;
      }
      const receiptEventPayload = { source: 'x402-autopay', scope, paidByRole: upstreamRole, paidByExecutor: true, txHash, transaction: txHash, paymentId };
      const receiptRef = await postEvent({ sessionId: session.sessionId, role: upstreamRole, type: 'receipt_reference', runtimeId: process.env.RUNTIME_ID || 'pm2-llm-executor-bot', payload: receiptEventPayload, metadata: { source: 'x402-autopay', paidByExecutor: true } });
      await postReceipt({ sessionId: session.sessionId, receiptType: 'x402_arc_native', payloadHash: sha256(receiptEventPayload), metadata: { role: upstreamRole, scope, source: 'x402-autopay', paidByExecutor: true, txHash, paymentId, bridgePayloadHash: receiptRef.payloadHash, protocolTxMode: 'arc_testnet' } });
      const roleLabel = upstreamRole.charAt(0).toUpperCase() + upstreamRole.slice(1);
      const liveResult = await safePostLiveEvent('x402_paid', {
        sessionId: session.sessionId,
        paymentId,
        bridgePayloadHash: receiptRef.payloadHash,
        txHash,
        amountAtomic: payment.amount || null,
        title: `${roleLabel} x402 paid`,
        summary: `${roleLabel} upstream x402 payment settled by executor`,
        trace: ['executor', 'receipt_reference', 'x402_arc_native', 'x402_paid'],
        reasoning: `executor upstream x402 autopay for ${upstreamRole}`
      });
      if (!liveResult.ok) throw new Error(liveResult.message || liveResult.error || 'live_event_failed');
    } finally { try { if (lp) require('node:fs').unlinkSync(lp); } catch {} }
  }

  await payUpstreamRole('evaluator');
  await payUpstreamRole('analyzer');
} finally {
  releaseRoleLock(rlp);
}
}

runForever("executor", runOnce).catch((err) => { console.error(`[executor] fatal: ${err.message}`); process.exitCode = 1; });
