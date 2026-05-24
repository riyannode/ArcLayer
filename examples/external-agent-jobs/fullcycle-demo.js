/**
 * Fullcycle demo — create → claim → running → submit → verify → settle
 *
 * Settlement is dry-run unless LIVE_JOB_SETTLEMENT=true.
 */
require('dotenv').config();
const {
  createJob,
  claimJob,
  getJob,
  markRunning,
  submitJob,
  verifyJob,
} = require('./shared/job-client');

const JOB_TYPE = process.env.JOB_TYPE || 'generic_analysis';
const BUYER_AGENT_ID = process.env.BUYER_AGENT_ID || 'agent_buyer_001';
const WORKER_ID = process.env.WORKER_ID || 'agent_worker_001';
const PROVIDER_AGENT_ID = process.env.PROVIDER_AGENT_ID || 'agent_provider_001';
const VERIFIER_AGENT_ID = process.env.VERIFIER_AGENT_ID || 'agent_verifier_001';
const ARCLAYER_BASE_URL = process.env.ARCLAYER_BASE_URL || 'http://localhost:3000';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Agent Job Fullcycle Demo ===');
  console.log();

  // 1. Create job
  console.log('1. Creating job...');
  const created = await createJob({
    jobType: JOB_TYPE,
    buyerAgentId: BUYER_AGENT_ID,
    inputPayload: { type: 'analysis', params: { query: 'Demo analysis' } },
    priceAtomic: '1000000', // 1 USDC
    metadata: { demo: true, source: 'fullcycle-demo' },
  });
  const jobId = created.job.job_id;
  console.log(`   Job created: ${jobId} (status: ${created.job.status})`);
  console.log();

  await sleep(500);

  // 2. Claim job
  console.log('2. Claiming job...');
  const claimed = await claimJob({
    jobType: JOB_TYPE,
    workerId: WORKER_ID,
    providerAgentId: PROVIDER_AGENT_ID,
    claimTtlSeconds: 600,
  });
  console.log(`   Job claimed: ${claimed.job.job_id} (status: ${claimed.job.status})`);
  console.log();

  await sleep(500);

  // 3. Mark running
  console.log('3. Marking job as running...');
  const running = await markRunning({ jobId, workerId: WORKER_ID });
  console.log(`   Job running: ${running.job.job_id} (status: ${running.job.status})`);
  console.log();

  // 4. Submit result
  console.log('4. Submitting result...');
  await sleep(500);
  const submitted = await submitJob({
    jobId,
    workerId: WORKER_ID,
    resultPayload: {
      analysis: { signal: 'bullish', confidence: 0.75 },
      processedAt: new Date().toISOString(),
    },
    proofPayload: { model: 'deepseek-v4-flash', processingTimeMs: 2340 },
  });
  console.log(`   Job submitted: ${submitted.job.job_id} (status: ${submitted.job.status})`);
  console.log();

  await sleep(500);

  // 5. Verify
  console.log('5. Verifying job...');
  const verified = await verifyJob({
    jobId,
    verifierAgentId: VERIFIER_AGENT_ID,
    approved: true,
    reason: 'Demo approval — result looks good',
  });
  console.log(`   Job verified: ${verified.job.job_id} (status: ${verified.job.status})`);
  console.log();

  // 6. Settlement
  const liveSettlement = process.env.LIVE_JOB_SETTLEMENT === 'true';
  if (liveSettlement) {
    console.log('6. Settling job (LIVE)...');
    console.log('   LIVE_JOB_SETTLEMENT=true — would execute x402 payment');
    console.log('   Requires x402 client with payer private key.');
    console.log('   See settle-job.js for details.');
  } else {
    console.log('6. Settlement (dry run):');
    console.log(`   POST ${ARCLAYER_BASE_URL}/api/agent-jobs/${jobId}/settle`);
    console.log('   LIVE_JOB_SETTLEMENT=false — no actual payment sent');
    console.log();
    console.log('   To settle, run: LIVE_JOB_SETTLEMENT=true node settle-job.js', jobId);
  }

  console.log();
  console.log('=== Demo complete ===');
  console.log('Final job status:', verified.job.status);
  console.log('Job ID:', jobId);
}

main().catch((err) => {
  console.error('Demo failed:', err.message);
  process.exit(1);
});
