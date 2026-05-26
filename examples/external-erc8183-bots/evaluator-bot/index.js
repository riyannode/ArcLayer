/**
 * Evaluator bot — reviews deliverables, approves/complete escrow.
 *
 * Loop:
 *   1. Poll for submitted jobs (evaluatorAgentId matches)
 *   2. Read job spec, result payload, proof payload
 *   3. Run evaluator strategy (rules-based MVP)
 *   4. If approved: call complete, sign + broadcast complete tx
 *   5. If rejected: log reason (no dispute path yet)
 */
require('dotenv').config({ path: __dirname + '/.env' });

const api = require('../shared/erc8183-http-client');
const { createSigner } = require('../shared/tx-signer');
const { required, requiredAddress, normalizePrivateKey } = require('../shared/env');
const { sleep } = require('../shared/sleep');

// ── Env ─────────────────────────────────────────────────────────────────
const BASE_URL = required('ARCLAYER_BASE_URL');
const EVALUATOR_AGENT_ID = required('EVALUATOR_AGENT_ID');
const EVALUATOR_ADDRESS = requiredAddress('EVALUATOR_ADDRESS');
const EVALUATOR_PK = normalizePrivateKey(required('EVALUATOR_PRIVATE_KEY'));
const ARC_RPC_URL = required('ARC_RPC_URL');
const POLL_INTERVAL_MS = parseInt(process.env.JOB_POLL_INTERVAL_MS || '5000', 10);
const AUTONOMOUS_TX = process.env.AUTONOMOUS_TX === 'true';
const EVALUATOR_MODE = process.env.EVALUATOR_MODE || 'rules';

// ── Signer ──────────────────────────────────────────────────────────────
const signer = createSigner({ privateKey: EVALUATOR_PK, rpcUrl: ARC_RPC_URL });
console.log(`Evaluator signer address: ${signer.address}`);

// Track processed jobs
const processedJobs = new Set();

// ── Evaluator strategies ────────────────────────────────────────────────

function evaluateByRules(job, resultPayload, proofPayload) {
  const checks = {
    hasResult: Boolean(resultPayload),
    hasProof: Boolean(proofPayload),
    hasWorkerId: Boolean(resultPayload?.workerId),
    hasTimestamps: Boolean(resultPayload?.processedAt),
    hasRunId: Boolean(resultPayload?.runId),
  };

  const allPassed = Object.values(checks).every(Boolean);
  return {
    approved: allPassed,
    score: allPassed ? 100 : 0,
    checks,
    reason: allPassed ? 'deliverable-approved' : 'deliverable-rejected: missing required fields',
  };
}

// ── Poll + process ──────────────────────────────────────────────────────

async function pollAndProcess() {
  try {
    let jobs;
    try {
      const result = await api.listJobs({ status: 'submitted', limit: '50' });
      jobs = Array.isArray(result) ? result : result?.jobs || result?.data || [];
    } catch {
      jobs = [];
    }

    if (!Array.isArray(jobs)) jobs = [];

    const submittedJobs = jobs.filter((job) => {
      return (
        job.evaluatorAgentId === EVALUATOR_AGENT_ID &&
        job.erc8183_status === 'Submitted' &&
        !processedJobs.has(job.localJobId || job.id)
      );
    });

    if (submittedJobs.length === 0) return;

    for (const job of submittedJobs) {
      const localJobId = job.localJobId || job.id;
      console.log(`\n[${new Date().toISOString()}] Found submitted job: ${localJobId}`);
      await evaluateAndComplete(localJobId);
    }
  } catch (err) {
    console.error(`   Poll error:`, err.message);
  }
}

async function evaluateAndComplete(localJobId) {
  try {
    // 1. Get full job details
    const job = await api.getJob(localJobId);
    console.log(`   Job spec: ${job.description || 'n/a'}`);

    // 2. Extract result/proof
    const resultPayload = job.resultPayload || job.deliverable || {};
    const proofPayload = job.proofPayload || job.proof || {};

    console.log(`   Result: ${JSON.stringify(resultPayload).slice(0, 200)}`);
    console.log(`   Proof: ${JSON.stringify(proofPayload).slice(0, 200)}`);

    // 3. Run evaluation strategy
    let evaluation;
    if (EVALUATOR_MODE === 'rules') {
      evaluation = evaluateByRules(job, resultPayload, proofPayload);
    } else {
      // LLM evaluator placeholder
      console.warn(`   Unknown evaluator mode: ${EVALUATOR_MODE}, using rules`);
      evaluation = evaluateByRules(job, resultPayload, proofPayload);
    }

    console.log(`   Evaluation: approved=${evaluation.approved}, score=${evaluation.score}`);
    console.log(`   Checks: ${JSON.stringify(evaluation.checks)}`);

    // 4. If approved, complete escrow
    if (evaluation.approved) {
      console.log(`   Approving & completing...`);
      const completed = await api.complete(localJobId, {
        evaluatorAgentId: EVALUATOR_AGENT_ID,
        approved: true,
        reason: evaluation.reason,
      });

      if (AUTONOMOUS_TX) {
        console.log(`   Signing complete tx...`);
        const completeResult = await signer.sendTx(completed.tx);
        console.log(`   complete tx: ${completeResult.hash}`);
        await sleep(2000);

        const confirmed = await api.confirmTx(localJobId, 'complete', completeResult.hash);
        console.log(`   Complete confirmed! status: ${confirmed.erc8183Status}`);
      } else {
        console.log(`   [MANUAL TX] complete instruction:`);
        console.log(`     ${JSON.stringify(completed.tx)}`);
      }

      console.log(`   ✅ Job ${localJobId} completed`);
    } else {
      console.warn(`   ❌ Evaluation FAILED: ${evaluation.reason}`);
      // MVP: no rejection path yet — log only
      console.warn(`   Job ${localJobId} not completed (rejection flow coming in Batch 4+)`);
    }

    processedJobs.add(localJobId);

  } catch (err) {
    console.error(`   ❌ Job ${localJobId} evaluation failed:`, err.message);
    if (err.body) console.error('   body:', JSON.stringify(err.body));
    processedJobs.add(localJobId);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== ERC-8183 Evaluator Bot ===');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Evaluator: ${EVALUATOR_AGENT_ID}`);
  console.log(`Address: ${EVALUATOR_ADDRESS}`);
  console.log(`Mode: ${EVALUATOR_MODE}`);
  console.log(`Autonomous: ${AUTONOMOUS_TX}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);

  await pollAndProcess();
  setInterval(pollAndProcess, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
