require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const fs = require('node:fs');
const path = require('node:path');
const { callLLM } = require("./shared/llm-client");
const { latestSession, postEvent, postReceipt, safePostLiveEvent, sha256, getJson, hasExecutorX402Proof } = require("./shared/arclayer-client");
const { runForever } = require("./shared/runner");
const { payForBridgeAccess } = require("./shared/x402-client");

function lockPath(sessionId, scope) { return path.resolve(__dirname, '.x402-locks', `${sessionId}-${scope}.lock`); }
function acquireLock(sessionId, scope) { fs.mkdirSync(path.resolve(__dirname, '.x402-locks'), { recursive: true }); const lp = lockPath(sessionId, scope); try { const fd = fs.openSync(lp, 'wx'); fs.closeSync(fd); return lp; } catch (err) { if (err && err.code === 'EEXIST') return null; throw err; } }
function releaseLock(lp) { try { if (lp) fs.unlinkSync(lp); } catch {} }

async function runOnce() {
  const { session } = await latestSession({ requiredRoles: ['analyzer', 'evaluator'] });
  if (!session?.sessionId) throw new Error('No latest bridge session.');
  const analyzerPayload = session.roles?.analyzer?.payload;
  const evaluatorPayload = session.roles?.evaluator?.payload;
  if (!analyzerPayload) throw new Error('Missing analyzer output.');
  if (!evaluatorPayload) throw new Error('Missing evaluator output.');
  if (typeof evaluatorPayload.approved !== 'boolean') throw new Error('Invalid evaluator approval shape.');

  const payload = { source: 'llm-executor', action: 'DRY_RUN_ONLY', mode: 'DRY_RUN', reason: evaluatorPayload.approved ? 'Dry-run only' : 'Skipped: evaluator rejected' };
  const posted = await postEvent({ sessionId: session.sessionId, role: 'executor', type: 'execution_intent', runtimeId: process.env.RUNTIME_ID || 'pm2-llm-executor-bot', payload });
  await postReceipt({ sessionId: session.sessionId, receiptType: 'x402_arc_native', payloadHash: posted.payloadHash, metadata: { role: 'executor' } });

  if (!evaluatorPayload.approved) return;
  if (process.env.X402_AUTOPAY !== 'true' || process.env.PROTOCOL_TX_MODE !== 'ARC_TESTNET') return;
  const scope = 'external_trace';
  let lp;
  try {
    lp = acquireLock(session.sessionId, scope);
    if (!lp) {
      console.log(`[x402][executor] lock_exists session=${session.sessionId} scope=${scope}, skip`);
      return;
    }
    const payment = await payForBridgeAccess({ sessionId: session.sessionId, scope, role: 'executor' });
    if (!payment.ok) return;
    if (payment.alreadyPaid) {
      console.log(`[x402][executor] already_paid session=${session.sessionId} tx=${payment.txHash || payment.transaction || 'n/a'}`);
      // Idempotency: check if proofs already exist before reposting
      const existingEvents = await getJson(`/api/agent-bridge/events?sessionId=${encodeURIComponent(session.sessionId)}&limit=50`, { authenticated: true }).catch(() => ({ events: [] }));
      const existingReceipts = await getJson(`/api/agent-bridge/receipts?sessionId=${encodeURIComponent(session.sessionId)}&limit=50`, { authenticated: true }).catch(() => ({ receipts: [] }));
      const existingLive = await getJson(`/api/a2a/live-events?category=prediction-market-bots&sessionId=${encodeURIComponent(session.sessionId)}&limit=50`, { authenticated: true }).catch(() => ({ events: [] }));
      if (hasExecutorX402Proof({ sessionId: session.sessionId, events: existingEvents.events || [], receipts: existingReceipts.receipts || [], liveEvents: existingLive.events || [] })) {
        console.log(`[x402][executor] proofs already exist for session=${session.sessionId}, skip repost`);
        return;
      }
    }
    const txHash = payment.txHash || payment.transaction || null;
    const paymentId = payment.paymentId || null;
    const receiptEventPayload = { source: 'x402-autopay', scope, role: 'executor', txHash, transaction: txHash, paymentId };
    const receiptRef = await postEvent({ sessionId: session.sessionId, role: 'executor', type: 'receipt_reference', runtimeId: process.env.RUNTIME_ID || 'pm2-llm-executor-bot', payload: receiptEventPayload, metadata: { source: 'x402-autopay' } });
    await postReceipt({ sessionId: session.sessionId, receiptType: 'x402_arc_native', payloadHash: sha256(receiptEventPayload), metadata: { role: 'executor', scope, source: 'x402-autopay', txHash, paymentId, bridgePayloadHash: receiptRef.payloadHash, protocolTxMode: 'arc_testnet' } });
    const liveResult = await safePostLiveEvent('x402_paid', {
      sessionId: session.sessionId,
      paymentId,
      bridgePayloadHash: receiptRef.payloadHash,
      txHash,
      amountAtomic: payment.amount || null,
      title: 'Executor x402 paid',
      summary: 'Executor external_trace x402 payment settled',
      trace: ['executor', 'receipt_reference', 'x402_arc_native', 'x402_paid'],
      reasoning: 'executor external_trace x402 autopay'
    });
    if (!liveResult.ok) throw new Error(liveResult.message || liveResult.error || 'live_event_failed');
  } finally { releaseLock(lp); }
}

runForever("executor", runOnce).catch((err) => { console.error(`[executor] fatal: ${err.message}`); process.exitCode = 1; });
