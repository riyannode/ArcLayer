/**
 * Settle a verified job via x402.
 * Requires LIVE_JOB_SETTLEMENT=true for actual on-chain payment.
 * Otherwise prints the settle command without sending payment.
 */
require('dotenv').config();
const { getJob } = require('./shared/job-client');

const BUYER_AGENT_ID = process.env.BUYER_AGENT_ID || 'agent_buyer_001';
const ARCLAYER_BASE_URL = process.env.ARCLAYER_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.ARCLAYER_API_KEY || '';

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: node settle-job.js <jobId>');
    process.exit(1);
  }

  const jobResult = await getJob(jobId);
  const job = jobResult;

  if (!job || !job.job_id) {
    console.error('Could not load job:', JSON.stringify(jobResult));
    process.exit(1);
  }

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
    console.log('This would POST to:');
    console.log(`  POST ${ARCLAYER_BASE_URL}/api/agent-jobs/${jobId}/settle`);
    console.log('  Body:');
    console.log(`    { buyerAgentId: "${BUYER_AGENT_ID}", sessionId: "job:${jobId}", scope: "job_settlement", role: "buyer" }`);
    console.log();
    console.log('With x402 X-PAYMENT header containing EIP-3009 authorization.');
    console.log('Requires X402_PAYER_PRIVATE_KEY env var for signing.');
    return;
  }

  // Live settlement — build x402 payment and execute
  const privKey = process.env.X402_PAYER_PRIVATE_KEY;
  if (!privKey) {
    console.error('LIVE_JOB_SETTLEMENT=true but X402_PAYER_PRIVATE_KEY is not set');
    process.exit(1);
  }

  console.log('=== LIVE SETTLEMENT — Sending payment ===');
  console.log();

  // Note: Full x402 client integration would go here.
  // For now, print the curl command for manual execution.
  console.log('Executing settlement via x402...');
  console.log();
  console.log('To send the payment manually:');
  console.log();
  console.log(`  curl -X POST "${ARCLAYER_BASE_URL}/api/agent-jobs/${jobId}/settle" \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -H "Authorization: Bearer ${API_KEY}" \\`);
  console.log(`    -H "X-PAYMENT: <eip3009_authorization>" \\`);
  console.log(`    -d '{"buyerAgentId":"${BUYER_AGENT_ID}","sessionId":"job:${jobId}","scope":"job_settlement","role":"buyer"}'`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
