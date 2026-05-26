/**
 * Client bot — creates ERC-8183 escrow jobs, funds after provider sets budget.
 *
 * Correct ERC-8183 flow:
 *   1. Client creates job on-chain (createJob)
 *   2. Provider sets budget (setBudget) — contract restricts to provider
 *   3. Client approves USDC + funds
 *
 * Loop:
 *   1. Create local job via POST /api/erc8183-jobs
 *   2. Sign + broadcast createJob tx
 *   3. Confirm create tx to backend
 *   4. Poll until provider calls setBudget (erc8183_status = Funded)
 *   5. Approve USDC + sign approve
 *   6. Fund escrow + sign fund
 *   7. Confirm fund tx
 *   8. Wait JOB_CREATE_INTERVAL_MS
 */
require('dotenv').config({ path: __dirname + '/.env' });

const api = require('../shared/erc8183-http-client');
const { createSigner } = require('../shared/tx-signer');
const { required, requiredAddress, normalizePrivateKey } = require('../shared/env');
const { sleep } = require('../shared/sleep');

// ── Env ─────────────────────────────────────────────────────────────────
const BASE_URL = required('ARCLAYER_BASE_URL');
const CLIENT_ADDRESS = requiredAddress('CLIENT_ADDRESS');
const CLIENT_PK = normalizePrivateKey(required('CLIENT_PRIVATE_KEY'));
const BUYER_AGENT_ID = required('BUYER_AGENT_ID');
const PROVIDER_AGENT_ID = required('PROVIDER_AGENT_ID');
const PROVIDER_ADDRESS = requiredAddress('PROVIDER_ADDRESS');
const EVALUATOR_AGENT_ID = required('EVALUATOR_AGENT_ID');
const EVALUATOR_ADDRESS = requiredAddress('EVALUATOR_ADDRESS');
const ARC_RPC_URL = required('ARC_RPC_URL');
const JOB_BUDGET_ATOMIC = process.env.JOB_BUDGET_ATOMIC || '1000000';
const JOB_EXPIRY_SECONDS = parseInt(process.env.JOB_EXPIRY_SECONDS || '86400', 10);
const JOB_CREATE_INTERVAL_MS = parseInt(process.env.JOB_CREATE_INTERVAL_MS || '60000', 10);
const AUTONOMOUS_TX = process.env.AUTONOMOUS_TX === 'true';

const signer = createSigner({ privateKey: CLIENT_PK, rpcUrl: ARC_RPC_URL });

let jobCounter = 0;

async function createAndFundJob() {
  jobCounter++;
  console.log(`\n[${new Date().toISOString()}] Job #${jobCounter}: creating...`);

  try {
    const balance = await signer.getUsdcBalance();
    const budgetAtomic = BigInt(JOB_BUDGET_ATOMIC);
    console.log(`   USDC balance: ${balance}, budget: ${budgetAtomic}`);

    // 1. Create local job
    const created = await api.createJob({
      buyerAgentId: BUYER_AGENT_ID,
      clientAddress: CLIENT_ADDRESS,
      providerAgentId: PROVIDER_AGENT_ID,
      providerAddress: PROVIDER_ADDRESS,
      evaluatorAgentId: EVALUATOR_AGENT_ID,
      evaluatorAddress: EVALUATOR_ADDRESS,
      expiredAtUnix: String(Math.floor(Date.now() / 1000) + JOB_EXPIRY_SECONDS),
      description: `Auto ERC-8183 job #${jobCounter}`,
      budgetAtomic: JOB_BUDGET_ATOMIC,
      inputPayload: { query: `Auto job ${jobCounter}`, createdAt: new Date().toISOString() },
    });

    const localJobId = created.localJobId;
    console.log(`   Local job: ${localJobId}`);

    if (AUTONOMOUS_TX) {
      // 2. Sign + broadcast createJob
      console.log(`   Signing createJob tx...`);
      const createResult = await signer.sendTx(created.tx);
      console.log(`   createJob tx: ${createResult.hash}`);
      await sleep(2000);

      const confirmed = await api.confirmCreateTx(localJobId, createResult.hash);
      console.log(`   createJob confirmed! erc8183_job_id: ${confirmed.erc8183JobId}`);

      // 3. Poll until provider sets budget (status = Funded)
      console.log(`   Waiting for provider to setBudget...`);
      const MAX_POLL = 60;
      let funded = false;
      for (let i = 0; i < MAX_POLL; i++) {
        await sleep(2000);
        try {
          const job = await api.getJob(localJobId);
          if (job.erc8183_status === 'Funded') {
            funded = true;
            break;
          }
        } catch {}
      }

      if (!funded) {
        console.warn(`   Provision timeout — job not funded by provider`);
        return;
      }
      console.log(`   Provider set budget! Job is Funded.`);

      // 4. Approve USDC + fund
      console.log(`   Getting fund tx instructions...`);
      const fundTx = await api.fund(localJobId);

      console.log(`   Signing approve tx...`);
      const approveResult = await signer.sendTx(fundTx.txs[0]);
      console.log(`   approve tx: ${approveResult.hash}`);
      await sleep(2000);

      console.log(`   Signing fund tx...`);
      const fundResult = await signer.sendTx(fundTx.txs[1]);
      console.log(`   fund tx: ${fundResult.hash}`);
      await sleep(2000);

      const fundConfirmed = await api.confirmTx(localJobId, 'fund', fundResult.hash);
      console.log(`   Fund confirmed! status: ${fundConfirmed.erc8183Status}`);
      console.log(`   ✅ Job #${jobCounter} funded successfully`);
    } else {
      console.log(`   [MANUAL TX] createJob: ${JSON.stringify(created.tx)}`);
    }
  } catch (err) {
    console.error(`   ❌ Job #${jobCounter} failed:`, err.message);
    if (err.body) console.error('   body:', JSON.stringify(err.body));
  }
}

async function main() {
  console.log('=== ERC-8183 Client Bot ===');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Client: ${CLIENT_ADDRESS}`);
  console.log(`Provider: ${PROVIDER_ADDRESS}`);
  console.log(`Evaluator: ${EVALUATOR_ADDRESS}`);
  console.log(`Budget: ${JOB_BUDGET_ATOMIC} (6 dec)`);
  console.log(`Autonomous: ${AUTONOMOUS_TX}`);
  console.log(`Interval: ${JOB_CREATE_INTERVAL_MS}ms`);

  await createAndFundJob();
  setInterval(createAndFundJob, JOB_CREATE_INTERVAL_MS);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
