/**
 * Provider bot — claims ERC-8183 funded jobs, sets budget, executes, submits.
 *
 * Correct ERC-8183 flow:
 *   1. Claim job (off-chain metadata)
 *   2. Set budget on-chain (contract restricts to provider)
 *   3. Mark running (off-chain metadata)
 *   4. Generate result + proof
 *   5. Submit deliverable on-chain
 *
 * Loop:
 *   1. Poll for jobs (providerAgentId matches, status=created)
 *   2. Claim job
 *   3. Sign + broadcast setBudget tx
 *   4. Mark running
 *   5. Generate echo result/proof
 *   6. Submit deliverable
 *   7. Sign + broadcast submit tx
 *   8. Confirm submit tx
 */
require('dotenv').config({ path: __dirname + '/.env' });

const api = require('../shared/erc8183-http-client');
const { createSigner } = require('../shared/tx-signer');
const { required, requiredAddress, normalizePrivateKey } = require('../shared/env');
const { sleep } = require('../shared/sleep');
const crypto = require('crypto');

// ── Env ─────────────────────────────────────────────────────────────────
const BASE_URL = required('ARCLAYER_BASE_URL');
const PROVIDER_AGENT_ID = required('PROVIDER_AGENT_ID');
const WORKER_ID = process.env.WORKER_ID || PROVIDER_AGENT_ID;
const PROVIDER_ADDRESS = requiredAddress('PROVIDER_ADDRESS');
const PROVIDER_PK = normalizePrivateKey(required('PROVIDER_PRIVATE_KEY'));
const ARC_RPC_URL = required('ARC_RPC_URL');
const POLL_INTERVAL_MS = parseInt(process.env.JOB_POLL_INTERVAL_MS || '5000', 10);
const AUTONOMOUS_TX = process.env.AUTONOMOUS_TX === 'true';
const CLAIM_TTL_SECONDS = parseInt(process.env.CLAIM_TTL_SECONDS || '600', 10);

const signer = createSigner({ privateKey: PROVIDER_PK, rpcUrl: ARC_RPC_URL });
console.log(`Provider signer address: ${signer.address}`);

const processedJobs = new Set();

async function pollAndProcess() {
  try {
    let jobs;
    try {
      const result = await api.listJobs({ status: 'created', limit: '50' });
      jobs = Array.isArray(result) ? result : result?.jobs || result?.data || [];
    } catch {
      jobs = [];
    }

    if (!Array.isArray(jobs)) jobs = [];

    const myJobs = jobs.filter((job) => {
      const id = job.localJobId || job.id;
      return (
        (job.providerAgentId === PROVIDER_AGENT_ID || !job.providerAgentId) &&
        (job.erc8183_status === 'Created' || job.erc8183_status === 'Open') &&
        !processedJobs.has(id)
      );
    });

    if (myJobs.length === 0) return;

    for (const job of myJobs) {
      const localJobId = job.localJobId || job.id;
      console.log(`\n[${new Date().toISOString()}] Found new job: ${localJobId} (${job.erc8183_status})`);
      await processJob(localJobId);
    }
  } catch (err) {
    console.error(`   Poll error:`, err.message);
  }
}

async function processJob(localJobId) {
  try {
    // 1. Claim (off-chain)
    console.log(`   Claiming...`);
    const claimed = await api.claim(localJobId, {
      workerId: WORKER_ID,
      providerAgentId: PROVIDER_AGENT_ID,
      claimTtlSeconds: CLAIM_TTL_SECONDS,
    });
    console.log(`   Claimed: status=${claimed.status}`);

    // 2. Set budget on-chain (provider signs setBudget)
    console.log(`   Getting setBudget tx instruction...`);
    const budgetTx = await api.setBudget(localJobId);

    if (AUTONOMOUS_TX) {
      console.log(`   Signing setBudget tx...`);
      const budgetResult = await signer.sendTx(budgetTx.tx);
      console.log(`   setBudget tx: ${budgetResult.hash}`);
      await sleep(2000);

      const budgetConfirmed = await api.confirmTx(localJobId, 'set_budget', budgetResult.hash);
      console.log(`   setBudget confirmed! status: ${budgetConfirmed.erc8183Status}`);
    } else {
      console.log(`   [MANUAL TX] setBudget: ${JSON.stringify(budgetTx.tx)}`);
      return; // Wait for manual
    }

    // 3. Mark running
    console.log(`   Marking running...`);
    const running = await api.markRunning(localJobId, WORKER_ID);
    console.log(`   Running: status=${running.status}`);

    // 4. Generate echo result
    const resultPayload = {
      workerId: WORKER_ID,
      status: 'completed',
      summary: 'Echo deliverable from provider bot.',
      processedAt: new Date().toISOString(),
      runId: crypto.randomUUID(),
    };
    const proofPayload = {
      runtime: 'pm2',
      durationMs: 500,
      model: 'rules-echo',
      provider: PROVIDER_AGENT_ID,
    };

    // 5. Submit
    console.log(`   Submitting...`);
    const submitted = await api.submit(localJobId, {
      workerId: WORKER_ID,
      resultPayload,
      proofPayload,
    });
    console.log(`   deliverableHash: ${submitted.deliverableHash}`);

    // 6. Sign submit tx
    if (AUTONOMOUS_TX) {
      console.log(`   Signing submit tx...`);
      const submitResult = await signer.sendTx(submitted.tx);
      console.log(`   submit tx: ${submitResult.hash}`);
      await sleep(2000);

      const confirmed = await api.confirmTx(localJobId, 'submit', submitResult.hash);
      console.log(`   Submit confirmed! status: ${confirmed.erc8183Status}`);
    } else {
      console.log(`   [MANUAL TX] submit: ${JSON.stringify(submitted.tx)}`);
    }

    processedJobs.add(localJobId);
    console.log(`   ✅ Job ${localJobId} submitted`);

  } catch (err) {
    console.error(`   ❌ Job ${localJobId} failed:`, err.message);
    if (err.body) console.error('   body:', JSON.stringify(err.body));
    processedJobs.add(localJobId);
  }
}

async function main() {
  console.log('=== ERC-8183 Provider Bot ===');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Provider: ${PROVIDER_AGENT_ID}`);
  console.log(`Worker: ${WORKER_ID}`);
  console.log(`Address: ${PROVIDER_ADDRESS}`);
  console.log(`Autonomous: ${AUTONOMOUS_TX}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);

  await pollAndProcess();
  setInterval(pollAndProcess, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
