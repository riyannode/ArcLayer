/**
 * Settle a verified job via x402 Arc Native EIP-3009 payment.
 *
 * Dry-run mode (LIVE_JOB_SETTLEMENT != true):
 *   Loads job, validates status, prints instructions.
 *
 * Live mode (LIVE_JOB_SETTLEMENT=true + X402_PAYER_PRIVATE_KEY set):
 *   1. Load job by jobId.
 *   2. POST unpaid to /api/agent-jobs/{jobId}/settle → 402 payment_required.
 *   3. Select Arc Native EIP-3009 requirement from accepts.
 *   4. Sign TransferWithAuthorization using X402_PAYER_PRIVATE_KEY.
 *   5. Retry POST with X-PAYMENT header.
 *   6. Decode PAYMENT-RESPONSE base64url header.
 *   7. Print paymentId and txHash.
 *   8. Exit non-zero if payment is rejected or settlement fails.
 */
require('dotenv').config();
const { getJob } = require('./shared/job-client');
const {
  base64Json,
  decodePaymentResponse,
  pickNativeRequirement,
  signTransferWithAuthorization,
  buildPaymentPayload,
} = require('./shared/x402-client');

const ARCLAYER_BASE_URL = process.env.ARCLAYER_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.ARCLAYER_API_KEY || '';

async function settledPost(url, body, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    ...options.headers,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ ok: false, error: 'invalid_json' }));
  const paymentResponse = decodePaymentResponse(
    res.headers.get('payment-response') || res.headers.get('PAYMENT-RESPONSE'),
  );
  return { status: res.status, ok: res.ok, json, paymentResponse, headers: res.headers };
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: node settle-job.js <jobId>');
    process.exit(1);
  }

  const job = await getJob(jobId);

  if (!job || !job.job_id) {
    console.error('Could not load job:', JSON.stringify(job));
    process.exit(1);
  }

  const buyerAgentId = process.env.BUYER_AGENT_ID || job.buyer_agent_id;

  console.log('Job to settle:');
  console.log(`  jobId: ${job.job_id}`);
  console.log(`  status: ${job.status}`);
  console.log(`  priceAtomic: ${job.price_atomic}`);
  console.log(`  buyerAgentId: ${job.buyer_agent_id}`);
  console.log();

  if (job.status !== 'verified' && job.status !== 'settlement_pending') {
    console.error(`Job is in status "${job.status}", expected "verified" or "settlement_pending"`);
    process.exit(1);
  }

  const liveSettlement = process.env.LIVE_JOB_SETTLEMENT === 'true';

  if (!liveSettlement) {
    console.log('=== DRY RUN — No actual payment ===');
    console.log();
    console.log('To settle, run:');
    console.log();
    console.log(`  LIVE_JOB_SETTLEMENT=true node settle-job.js ${jobId}`);
    console.log();
    console.log('Required env vars for live settlement:');
    console.log(`  X402_PAYER_PRIVATE_KEY — EOA private key for signing EIP-3009`);
    console.log(`  ARCLAYER_API_KEY — required for API authentication`);
    console.log(`  X402_RECEIVER_ADDRESS — payTo address (set on server side by deployer)`);
    console.log();
    console.log(`  BUYER_AGENT_ID — optional, defaults to job.buyer_agent_id from loaded job`);
    console.log(`  ARCLAYER_BASE_URL — default: http://localhost:3000`);
    console.log();
    console.log('Flow:');
    console.log(`  1. POST ${ARCLAYER_BASE_URL}/api/agent-jobs/${jobId}/settle`);
    console.log('     → 402 payment_required with accepts array');
    console.log('  2. Select Arc Native EIP-3009 requirement');
    console.log('  3. Sign TransferWithAuthorization');
    console.log('  4. Retry POST with X-PAYMENT header');
    console.log('  5. Decode PAYMENT-RESPONSE → paymentId + txHash');
    return;
  }

  // ─── Live settlement ──────────────────────────────────────────────────────

  const privKey = process.env.X402_PAYER_PRIVATE_KEY;
  if (!privKey) {
    console.error('LIVE_JOB_SETTLEMENT=true but X402_PAYER_PRIVATE_KEY is not set');
    process.exit(1);
  }

  console.log('=== LIVE SETTLEMENT ===');
  console.log();

  if (!API_KEY) {
    console.error('LIVE_JOB_SETTLEMENT=true but ARCLAYER_API_KEY is not set');
    process.exit(1);
  }

  const settleUrl = `${ARCLAYER_BASE_URL}/api/agent-jobs/${jobId}/settle`;
  const requestBody = {
    buyerAgentId,
    sessionId: `job:${jobId}`,
    scope: 'job_settlement',
    role: 'buyer',
  };

  // Step 1: POST without payment → expect 402 with accepts
  console.log('Step 1: Requesting payment requirements...');
  const challenge = await settledPost(settleUrl, requestBody);

  if (challenge.status !== 402 || !Array.isArray(challenge.json.accepts)) {
    console.error(`Expected 402 with accepts, got ${challenge.status}:`, JSON.stringify(challenge.json));
    process.exit(1);
  }

  console.log(`  Got 402 payment_required with ${challenge.json.accepts.length} option(s)`);
  console.log();

  // Step 2: Select Arc Native EIP-3009 requirement
  const accepted = pickNativeRequirement(challenge.json.accepts);
  if (!accepted) {
    console.error('No usable Arc Native EIP-3009 requirement in accepts');
    console.error('  accepts:', JSON.stringify(challenge.json.accepts, null, 2));
    process.exit(1);
  }

  console.log('Step 2: Selected Arc Native EIP-3009 requirement:');
  console.log(`  asset: ${accepted.asset}`);
  console.log(`  payTo: ${accepted.payTo}`);
  console.log(`  amount: ${accepted.amount}`);
  console.log();

  // Step 3: Sign TransferWithAuthorization
  console.log('Step 3: Signing EIP-3009 TransferWithAuthorization...');
  let signed;
  try {
    signed = await signTransferWithAuthorization(accepted, privKey);
  } catch (err) {
    console.error('  Failed to sign:', err.message);
    process.exit(1);
  }
  console.log(`  payer: ${signed.payer}`);
  console.log(`  nonce: ${signed.nonce}`);
  console.log();

  // Step 4: Build payment payload and retry POST with X-PAYMENT header
  const resource = settleUrl;
  const paymentPayload = buildPaymentPayload(signed.signature, signed.authorization, accepted, resource);
  const xPaymentValue = base64Json(paymentPayload);

  console.log('Step 4: Sending paid settlement request...');
  const paid = await settledPost(settleUrl, requestBody, {
    headers: { 'X-PAYMENT': xPaymentValue },
  });

  // Step 5: Decode PAYMENT-RESPONSE
  const paymentResponse = paid.paymentResponse;
  const paymentId = paymentResponse?.paymentId || paid.json.paymentId || null;
  const txHash = paymentResponse?.transaction || paid.json.transaction || paid.json.txHash || null;
  const payer = paid.json.payer || signed.payer || null;

  // Handle session_already_paid (retry-safe idempotent settle)
  if (paid.json.error === 'session_already_paid') {
    console.log('  ⚠️ Session already paid (idempotent retry).');
    console.log(`  paymentId: ${paymentId}`);
    console.log(`  txHash: ${txHash}`);
    console.log();
    console.log('=== SETTLEMENT COMPLETE (already paid) ===');
    return;
  }

  if (!paid.ok || paid.json.ok === false) {
    console.error(`  Payment rejected: ${paid.status} ${paid.json.error || paid.json.reason || paid.json.message || 'unknown'}`);
    if (paid.json.detail) console.error('  detail:', JSON.stringify(paid.json.detail));
    process.exit(1);
  }

  console.log(`  status: ${paid.status}`);
  console.log(`  paymentId: ${paymentId}`);
  console.log(`  txHash: ${txHash}`);
  console.log(`  payer: ${payer}`);
  console.log();

  // Step 6: Success output
  if (!paymentId || !txHash) {
    console.error('  Settlement response missing paymentId or txHash');
    console.error('  response:', JSON.stringify(paid.json));
    console.error('  paymentResponse:', JSON.stringify(paymentResponse));
    process.exit(1);
  }

  console.log('=== SETTLEMENT COMPLETE ===');
  console.log(`  paymentId: ${paymentId}`);
  console.log(`  txHash: ${txHash}`);
  console.log(`  payer: ${payer}`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
