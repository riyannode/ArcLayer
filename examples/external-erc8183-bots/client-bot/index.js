/**
 * Client bot — creates ERC-8183 escrow jobs.
 *
 * Loop:
 *   1. Create local job via POST /api/erc8183-jobs
 *   2. Sign + broadcast createJob tx
 *   3. Confirm create tx to backend
 *   4. Set budget + sign setBudget
 *   5. Approve USDC + sign approve
 *   6. Fund escrow + sign fund
 *   7. Confirm fund tx
 *   8. Wait JOB_CREATE_INTERVAL_MS
 */
// ── Load env FIRST ──────────────────────────────────────────────────
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

// ── Signer ──────────────────────────────────────────────────────────────
const signer = createSigner({ privateKey: CLIENT_PK, rpcUrl: ARC_RPC_URL });

let jobCounter = 0;

async function createAndFundJob() {
  jobCounter++;
  const jobId = `erc8183-auto-${Date.now()}-${jobCounter}`;
  console.log(`\n[${new Date().toISOString()}] Job #${jobCounter}: creating...`);

  try {
    // 1. Check balance
    const balance = await signer.getUsdcBalance();
    const budgetAtomic = BigInt(JOB_BUDGET_ATOMIC);
    console.log(`   USDC balance: ${balance}, budget: ${budgetAtomic}`);
    if (balance < budgetAtomic + 10000n) {
      console.warn(`   WARN: Low USDC balance (${balance}), may fail approve/fund`);
    }

    // 2. Create local job
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

    // 3. Sign + broadcast createJob
    if (AUTONOMOUS_TX) {
      console.log(`   Signing createJob tx...`);
      const createResult = await signer.sendTx(created.tx);
      console.log(`   createJob tx: ${createResult.hash}`);
      await sleep(2000);

      const confirmed = await api.confirmCreateTx(localJobId, createResult.hash);
      const erc8183JobId = confirmed.erc8183JobId;
      console.log(`   createJob confirmed! erc8183_job_id: ${erc8183JobId}`);

      // 4. Set budget
      console.log(`   Signing setBudget tx...`);
      const budgetTx = await api.setBudget(localJobId);
      const budgetResult = await signer.sendTx(budgetTx.tx);
      console.log(`   setBudget tx: ${budgetResult.hash}`);
      await sleep(2000);

      const budgetConfirmed = await api.confirmTx(localJobId, 'set_budget', budgetResult.hash);
      console.log(`   setBudget confirmed! status: ${budgetConfirmed.erc8183Status}`);

      // 5. Approve USDC + fund
      console.log(`   Signing approve + fund txs...`);
      const fundTx = await api.fund(localJobId);

      // Approve first
      const approveResult = await signer.sendTx(fundTx.txs[0]);
      console.log(`   approve tx: ${approveResult.hash}`);
      await sleep(2000);

      // Then fund
      const fundResult = await signer.sendTx(fundTx.txs[1]);
      console.log(`   fund tx: ${fundResult.hash}`);
      await sleep(2000);

      const fundConfirmed = await api.confirmTx(localJobId, 'fund', fundResult.hash);
      console.log(`   Fund confirmed! status: ${fundConfirmed.erc8183Status}`);
      console.log(`   ✅ Job #${jobCounter} funded successfully`);
    } else {
      // Manual mode
      console.log(`   [MANUAL TX] createJob tx instruction:`);
      console.log(`     ${JSON.stringify(created.tx)}`);
      console.log(`   Set AUTONOMOUS_TX=true for auto-signing`);
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

  // Run first job immediately
  await createAndFundJob();

  // Schedule
  setInterval(createAndFundJob, JOB_CREATE_INTERVAL_MS);
  console.log(`\nNext job in ${JOB_CREATE_INTERVAL_MS}ms`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
