require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const fs = require('node:fs');
const path = require('node:path');
const { callLLM } = require("./shared/llm-client");
const { latestSession, postEvent, postReceipt, safePostLiveEvent, sha256 } = require("./shared/arclayer-client");
const { runForever } = require("./shared/runner");
const { payForBridgeAccess } = require("./shared/x402-client");

function lockPath(sessionId, scope) { return path.resolve(__dirname, '.x402-locks', `${sessionId}-${scope}.lock`); }
function acquireLock(sessionId, scope) { fs.mkdirSync(path.resolve(__dirname, '.x402-locks'), { recursive: true }); const lp = lockPath(sessionId, scope); const fd = fs.openSync(lp, 'wx'); fs.closeSync(fd); return lp; }
function releaseLock(lp) { try { if (lp) fs.unlinkSync(lp); } catch {} }

async function runOnce() {
  const { session } = await latestSession();
  if (!session?.sessionId) throw new Error('No latest bridge session.');
  const payload = { source: 'llm-executor', action: 'DRY_RUN_ONLY', mode: 'DRY_RUN', reason: 'Dry-run only' };
  const posted = await postEvent({ sessionId: session.sessionId, role: 'executor', type: 'execution_intent', runtimeId: process.env.RUNTIME_ID || 'pm2-llm-executor-bot', payload });
  await postReceipt({ sessionId: session.sessionId, payloadHash: posted.payloadHash, metadata: { role: 'executor' } });

  if (process.env.X402_AUTOPAY !== 'true' || process.env.PROTOCOL_TX_MODE !== 'ARC_TESTNET') return;
  const scope = 'external_trace';
  let lp;
  try {
    lp = acquireLock(session.sessionId, scope);
    const payment = await payForBridgeAccess({ sessionId: session.sessionId, scope, role: 'executor' });
    if (!payment.ok) return;
    const receiptEventPayload = { source: 'x402-autopay', scope, role: 'executor', txHash: payment.txHash || payment.transaction || null, transaction: payment.txHash || payment.transaction || null, paymentId: payment.paymentId || null };
    const receiptRef = await postEvent({ sessionId: session.sessionId, role: 'executor', type: 'receipt_reference', runtimeId: process.env.RUNTIME_ID || 'pm2-llm-executor-bot', payload: receiptEventPayload, metadata: { source: 'x402-autopay' } });
    await postReceipt({ sessionId: session.sessionId, receiptType: 'x402_payment_proof', payloadHash: sha256(receiptEventPayload), metadata: { role: 'executor', scope, source: 'x402-autopay', txHash: payment.txHash || payment.transaction || null, paymentId: payment.paymentId || null, bridgePayloadHash: receiptRef.payloadHash } });
    await safePostLiveEvent('x402_paid', { autoPublished: true, manualMirror: false, sessionId: session.sessionId, paymentId: payment.paymentId || null, bridgePayloadHash: receiptRef.payloadHash, protocolTxMode: 'arc_testnet', reasoning: 'executor external_trace x402 autopay' });
  } finally { releaseLock(lp); }
}

runForever("executor", runOnce).catch((err) => { console.error(`[executor] fatal: ${err.message}`); process.exitCode = 1; });
