/**
 * Client bot — creates ERC-8183 escrow jobs with random templates, funds after provider sets budget.
 *
 * Correct ERC-8183 flow:
 *   1. Client creates job on-chain (createJob)
 *   2. Provider sets budget (setBudget) — contract restricts to provider
 *   3. Client approves USDC + funds
 *
 * Loop:
 *   1. Pick random job template
 *   2. Create local job via POST /api/erc8183-jobs
 *   3. Sign + broadcast createJob tx
 *   4. Confirm create tx to backend
 *   5. Poll until provider calls setBudget (erc8183_status = Funded)
 *   6. Approve USDC + sign approve
 *   7. Fund escrow + sign fund
 *   8. Confirm fund tx
 *   9. Wait JOB_CREATE_INTERVAL_MS
 */
require('dotenv').config({ path: __dirname + '/.env' });

const api = require('../shared/erc8183-http-client');
api.setRole('client');
const { createSigner } = require('../shared/tx-signer');
const { required, requiredAddress, normalizePrivateKey } = require('../shared/env');
const { sleep } = require('../shared/sleep');
const crypto = require('crypto');

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
const JOB_BUDGET_ATOMIC = process.env.JOB_BUDGET_ATOMIC || '100000';
const JOB_EXPIRY_SECONDS = parseInt(process.env.JOB_EXPIRY_SECONDS || '86400', 10);
const JOB_CREATE_INTERVAL_MS = parseInt(process.env.JOB_CREATE_INTERVAL_MS || '180000', 10);
const MAX_JOBS_PER_RUN = parseInt(process.env.MAX_JOBS_PER_RUN || '0', 10); // 0 = unlimited
const MAX_OPEN_JOBS = parseInt(process.env.MAX_OPEN_JOBS || '5', 10);
const AUTONOMOUS_TX = process.env.AUTONOMOUS_TX === 'true';
const IGNORE_JOBS_BEFORE = process.env.IGNORE_JOBS_BEFORE || '';

const signer = createSigner({ privateKey: CLIENT_PK, rpcUrl: ARC_RPC_URL });

let jobCounter = 0;
let jobsCreatedThisRun = 0;

// ── Random job templates ─────────────────────────────────────────────────

const JOB_TEMPLATES = [
  {
    jobType: 'market_summary',
    query: 'Provide a concise market summary for the top 5 crypto assets by 24h volume.',
    requiredCapability: 'market-summary',
    difficulty: 'medium',
  },
  {
    jobType: 'risk_check',
    query: 'Evaluate the smart contract risk profile for a new DeFi lending protocol.',
    requiredCapability: 'risk-check',
    difficulty: 'hard',
  },
  {
    jobType: 'sentiment_scan',
    query: 'Scan social media and news sentiment for BTC and ETH over the last 24 hours.',
    requiredCapability: 'sentiment-scan',
    difficulty: 'easy',
  },
  {
    jobType: 'execution_plan',
    query: 'Generate an execution plan for a DCA strategy across 3 L2 chains.',
    requiredCapability: 'execution-plan',
    difficulty: 'medium',
  },
  {
    jobType: 'data_quality_check',
    query: 'Validate data feed consistency across 3 oracle sources for ETH/USD price.',
    requiredCapability: 'data-quality-check',
    difficulty: 'easy',
  },
];

function pickRandomTemplate() {
  const template = JOB_TEMPLATES[Math.floor(Math.random() * JOB_TEMPLATES.length)];
  return {
    ...template,
    nonce: crypto.randomBytes(8).toString('hex'),
    createdAt: new Date().toISOString(),
  };
}

// ── Fund existing jobs that already have setBudget ────────────────────

const fundedJobIds = new Set();

async function fundExistingJobs() {
  let jobs;
  try {
    const existing = await api.listJobs({ status: 'created', limit: '100', buyerAgentId: BUYER_AGENT_ID });
    jobs = Array.isArray(existing) ? existing : existing?.jobs || existing?.data || [];
  } catch { jobs = []; }

  const cutoff = IGNORE_JOBS_BEFORE ? new Date(IGNORE_JOBS_BEFORE).getTime() : 0;

  for (const job of (Array.isArray(jobs) ? jobs : [])) {
    const id = job.localJobId || job.id;
    if (fundedJobIds.has(id)) continue;

    // Skip stale jobs
    if (cutoff) {
      const jobTime = new Date(job.createdAt || job.created_at || 0).getTime();
      if (jobTime < cutoff) { fundedJobIds.add(id); continue; }
    }

    // Only fund jobs that have setBudgetTxHash set
    const setBudgetHash = job.setBudgetTxHash || job.txHashes?.setBudgetTxHash;
    if (!setBudgetHash) continue;

    console.log(`\n[${new Date().toISOString()}] [FUND] Funding existing job: ${id} (setBudget=${setBudgetHash.slice(0, 10)}...)`);
    try {
      const fundTxInstructions = await api.fund(id);
      if (!fundTxInstructions.txs || fundTxInstructions.txs.length < 2) {
        console.warn(`   Fund endpoint didn't return tx instructions`);
        fundedJobIds.add(id);
        continue;
      }

      const approveResult = await signer.sendTx(fundTxInstructions.txs[0]);
      console.log(`   approve tx: ${approveResult.hash}`);
      await sleep(2000);

      const fundResult = await signer.sendTx(fundTxInstructions.txs[1]);
      console.log(`   fund tx: ${fundResult.hash}`);
      await sleep(2000);

      const fundConfirmed = await api.confirmTx(id, 'fund', fundResult.hash);
      console.log(`   Fund confirmed! status: ${fundConfirmed.erc8183Status}`);
      console.log(`   ✅ Job ${id} funded successfully`);
    } catch (err) {
      console.error(`   [FUND] Failed:`, err.message);
    }
    fundedJobIds.add(id);
  }
}

// ── Create + fund job ────────────────────────────────────────────────────

async function createAndFundJob() {
  jobCounter++;
  jobsCreatedThisRun++;
  console.log(`\n[${new Date().toISOString()}] Job #${jobCounter}: creating...`);

  // Safety: MAX_JOBS_PER_RUN
  if (MAX_JOBS_PER_RUN > 0 && jobsCreatedThisRun > MAX_JOBS_PER_RUN) {
    console.log(`   Reached MAX_JOBS_PER_RUN (${MAX_JOBS_PER_RUN}) — stopping`);
    process.exit(0);
  }

  try {
    // Safety: check existing open jobs (filter by IGNORE_JOBS_BEFORE to skip stale backlog)
    const existing = await api.listJobs({ status: 'created', limit: '100', buyerAgentId: BUYER_AGENT_ID });
    const existingList = Array.isArray(existing) ? existing : existing?.jobs || existing?.data || [];
    const cutoff = IGNORE_JOBS_BEFORE ? new Date(IGNORE_JOBS_BEFORE).getTime() : 0;
    const openCount = existingList.filter((j) => {
      // Skip jobs that already progressed past Open
      const ls = j.lifecycleStatus || '';
      if (ls && ls !== 'Open' && ls !== 'CreatedOnchain') return false;
      if (j.erc8183Status && j.erc8183Status !== 'Open') return false;
      if (cutoff) {
        const jobTime = new Date(j.createdAt || j.created_at || 0).getTime();
        if (jobTime < cutoff) return false;
      }
      return true;
    }).length;
    if (openCount >= MAX_OPEN_JOBS) {
      console.log(`   Too many open jobs (${openCount} >= ${MAX_OPEN_JOBS}) — skipping this cycle`);
      return;
    }

    const balance = await signer.getUsdcBalance();
    const budgetAtomic = BigInt(JOB_BUDGET_ATOMIC);
    console.log(`   USDC balance: ${balance}, budget: ${budgetAtomic}`);

    // Pick random template
    const template = pickRandomTemplate();
    console.log(`   Template: ${template.jobType} (${template.requiredCapability})`);

    // 1. Create local job
    const created = await api.createJob({
      buyerAgentId: BUYER_AGENT_ID,
      clientAddress: CLIENT_ADDRESS,
      providerAgentId: PROVIDER_AGENT_ID,
      providerAddress: PROVIDER_ADDRESS,
      evaluatorAgentId: EVALUATOR_AGENT_ID,
      evaluatorAddress: EVALUATOR_ADDRESS,
      expiredAtUnix: String(Math.floor(Date.now() / 1000) + JOB_EXPIRY_SECONDS),
      description: `[${template.jobType}] ${template.query.slice(0, 80)}`,
      budgetAtomic: JOB_BUDGET_ATOMIC,
      inputPayload: {
        jobType: template.jobType,
        query: template.query,
        requiredCapability: template.requiredCapability,
        difficulty: template.difficulty,
        nonce: template.nonce,
        createdAt: template.createdAt,
      },
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

      // 3. Wait for provider to setBudget — poll job detail for setBudgetTxHash
      console.log(`   Waiting for provider to setBudget...`);
      const SETBUDGET_POLL_MAX = parseInt(process.env.SETBUDGET_POLL_MAX || '120', 10);
      const FUND_POLL_INTERVAL_MS = parseInt(process.env.FUND_POLL_INTERVAL_MS || '5000', 10);
      let setBudgetReady = false;
      for (let i = 0; i < SETBUDGET_POLL_MAX; i++) {
        await sleep(FUND_POLL_INTERVAL_MS);
        try {
          const jobResponse = await api.getJob(localJobId);
          const jobDetail = jobResponse.job || jobResponse;
          // setBudgetTxHash may be at job.txHashes.setBudgetTxHash or job.setBudgetTxHash
          const setBudgetHash = jobDetail.setBudgetTxHash || jobDetail.txHashes?.setBudgetTxHash;
          if (setBudgetHash) {
            setBudgetReady = true;
            console.log(`   setBudget confirmed in backend: ${setBudgetHash}`);
            break;
          }
          // Also check lifecycleStatus
          if (jobDetail.lifecycleStatus && jobDetail.lifecycleStatus !== 'Open' && jobDetail.lifecycleStatus !== 'CreatedOnchain') {
            setBudgetReady = true;
            console.log(`   Budget already set (lifecycleStatus=${jobDetail.lifecycleStatus})`);
            break;
          }
        } catch {
          // ignore poll errors
        }
        if (i % 6 === 0 && i > 0) console.log(`   Waiting for setBudget... (${i * FUND_POLL_INTERVAL_MS / 1000}s)`);
      }

      if (!setBudgetReady) {
        console.warn(`   Timeout — provider didn't set budget`);
        return;
      }
      console.log(`   Provider set budget! Proceeding to fund.`);

      // 4. Get fund tx instructions
      const fundTxInstructions = await api.fund(localJobId);
      if (!fundTxInstructions.txs || fundTxInstructions.txs.length < 2) {
        console.warn(`   Fund endpoint didn't return tx instructions`);
        return;
      }

      // 4. Approve USDC + fund — use fundTxInstructions from poll
      const approveResult = await signer.sendTx(fundTxInstructions.txs[0]);
      console.log(`   approve tx: ${approveResult.hash}`);
      await sleep(2000);

      console.log(`   Signing fund tx...`);
      const fundResult = await signer.sendTx(fundTxInstructions.txs[1]);
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
  console.log('=== ERC-8183 Client Bot (autonomous job market) ===');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Client: ${CLIENT_ADDRESS}`);
  console.log(`Provider: ${PROVIDER_ADDRESS}`);
  console.log(`Evaluator: ${EVALUATOR_ADDRESS}`);
  console.log(`Budget: ${JOB_BUDGET_ATOMIC} (6 dec)`);
  console.log(`Autonomous: ${AUTONOMOUS_TX}`);
  console.log(`Interval: ${JOB_CREATE_INTERVAL_MS}ms`);
  console.log(`Templates: ${JOB_TEMPLATES.length} random types`);

  await fundExistingJobs();
  await createAndFundJob();
  setInterval(async () => {
    await fundExistingJobs();
    await createAndFundJob();
  }, JOB_CREATE_INTERVAL_MS);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
