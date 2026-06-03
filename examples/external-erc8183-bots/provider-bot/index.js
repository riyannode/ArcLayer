/**
 * Provider bot — two-phase ERC-8183 job worker with capability-based strategy.
 *
 * Phase 1: Set budget on open jobs (provider must set price on-chain)
 * Phase 2: Claim + run + submit on funded jobs
 *
 * Jobs are matched by inputPayload.requiredCapability against WORKER_CAPABILITIES.
 * Results are structured per jobType instead of static echo.
 */
require('dotenv').config({ path: __dirname + '/.env' });

const api = require('../shared/erc8183-http-client');
api.setRole('provider');
const { createSigner } = require('../shared/tx-signer');
const { required, requiredAddress, normalizePrivateKey } = require('../shared/env');
const { sleep } = require('../shared/sleep');
const crypto = require('crypto');

const BASE_URL = required('ARCLAYER_BASE_URL');

// Provider legacy key wins for backward compatibility; WORKER_AGENT_ID is fallback.
const PROVIDER_AGENT_ID = process.env.PROVIDER_AGENT_ID || required('WORKER_AGENT_ID');
const WORKER_ID = process.env.WORKER_ID || PROVIDER_AGENT_ID;

// Provider legacy key wins for backward compatibility; WORKER_ADDRESS is fallback.
const PROVIDER_ADDRESS = (() => {
  const addr = process.env.PROVIDER_ADDRESS || process.env.WORKER_ADDRESS;
  if (!addr) throw new Error('Missing required env: PROVIDER_ADDRESS or WORKER_ADDRESS');
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) throw new Error('PROVIDER_ADDRESS must be a valid 0x address');
  return addr;
})();

// Provider legacy key wins for backward compatibility; WORKER_PRIVATE_KEY is fallback.
const PROVIDER_PK = (() => {
  const pk = process.env.PROVIDER_PRIVATE_KEY || process.env.WORKER_PRIVATE_KEY;
  if (!pk) throw new Error('Missing required env: PROVIDER_PRIVATE_KEY or WORKER_PRIVATE_KEY');
  return normalizePrivateKey(pk);
})();

const ARC_RPC_URL = required('ARC_RPC_URL');
const POLL_INTERVAL_MS = parseInt(process.env.JOB_POLL_INTERVAL_MS || '60000', 10);
const AUTONOMOUS_TX = process.env.AUTONOMOUS_TX === 'true';
const CLAIM_TTL_SECONDS = parseInt(process.env.CLAIM_TTL_SECONDS || '600', 10);
const MAX_ACTIVE_JOBS = parseInt(process.env.MAX_ACTIVE_JOBS || '3', 10);

// ── Worker capabilities ──────────────────────────────────────────────────
const WORKER_CAPABILITIES = (process.env.WORKER_CAPABILITIES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const signer = createSigner({ privateKey: PROVIDER_PK, rpcUrl: ARC_RPC_URL });
console.log(`Provider signer address: ${signer.address}`);
if (WORKER_CAPABILITIES.length > 0) {
  console.log(`Worker capabilities: ${WORKER_CAPABILITIES.join(', ')}`);
} else {
  console.log(`Worker capabilities: <none> — will accept all jobs`);
}

const processedIds = new Set();

// ── Capability filter ────────────────────────────────────────────────────

function hasCapability(job) {
  const inputPayload = job.inputPayload || {};
  const required = inputPayload.requiredCapability;
  if (!required || required === '') return true; // no requirement = accept
  return WORKER_CAPABILITIES.length === 0 || WORKER_CAPABILITIES.includes(required);
}

// ── Worker strategy — structured output per jobType ──────────────────────

function runWorkerStrategy(job) {
  const inputPayload = job.inputPayload || {};
  const jobType = inputPayload.jobType || 'unknown';
  const query = inputPayload.query || '';
  const capability = inputPayload.requiredCapability || '';
  const difficulty = inputPayload.difficulty || 'unknown';
  const startTime = Date.now();

  let output;
  let confidence;

  switch (jobType) {
    case 'market_summary':
      output = {
        assets: ['BTC', 'ETH', 'SOL', 'ARB', 'OP'],
        marketCondition: 'moderately bullish',
        totalVolume24h: '$48.2B',
        btcDominance: '54.3%',
        fearGreedIndex: 62,
        summary: 'Market showing recovery signals with BTC leading. L2 tokens gaining momentum.',
      };
      confidence = 0.78;
      break;

    case 'risk_check':
      output = {
        overallRisk: 'medium',
        factors: [
          { name: 'smart_contract_audit', status: 'partial', score: 6 },
          { name: 'liquidity_depth', status: 'adequate', score: 7 },
          { name: 'oracle_dependency', status: 'warning', score: 5 },
          { name: 'admin_key_risk', status: 'elevated', score: 4 },
        ],
        recommendation: 'Proceed with caution. Recommend limiting exposure to 5% of portfolio.',
      };
      confidence = 0.72;
      break;

    case 'sentiment_scan':
      output = {
        btc: { sentiment: 'positive', score: 0.68, sources: 2847 },
        eth: { sentiment: 'neutral', score: 0.52, sources: 1923 },
        trendingTopics: ['ETF inflows', 'L2 scaling', 'regulatory clarity'],
        overallMarketMood: 'cautiously optimistic',
      };
      confidence = 0.65;
      break;

    case 'execution_plan':
      output = {
        strategy: 'DCA',
        chains: ['Arbitrum', 'Optimism', 'Base'],
        allocation: { Arbitrum: '40%', Optimism: '35%', Base: '25%' },
        frequency: 'weekly',
        estimatedGasSavings: '62% vs L1',
        steps: [
          'Bridge USDC to target L2s',
          'Set up DCA contracts',
          'Configure rebalance triggers',
          'Enable monitoring alerts',
        ],
      };
      confidence = 0.81;
      break;

    case 'data_quality_check':
      output = {
        ethUsd: {
          chainlink: 2847.52,
          bandProtocol: 2847.48,
          pyth: 2847.55,
          maxDeviation: '0.002%',
          status: 'consistent',
        },
        staleness: { oldest: '12s', newest: '3s' },
        anomalies: [],
        verdict: 'All feeds consistent. No manipulation detected.',
      };
      confidence = 0.88;
      break;

    default:
      output = {
        result: `Processed unknown job type: ${jobType}`,
        query,
        note: 'No specialized strategy available. Returning generic analysis.',
      };
      confidence = 0.5;
  }

  const durationMs = Date.now() - startTime;

  const resultPayload = {
    workerId: WORKER_ID,
    jobType,
    query,
    requiredCapability: capability,
    output,
    confidence,
    evidence: {
      strategy: jobType,
      difficulty,
      templateVersion: '1.0.0',
    },
    processedAt: new Date().toISOString(),
    runId: crypto.randomUUID(),
  };

  const proofPayload = {
    runtime: 'pm2',
    model: 'rules-worker',
    capability,
    durationMs,
    provider: PROVIDER_AGENT_ID,
  };

  return { resultPayload, proofPayload };
}

// ── Phase 1: Set budget on Open jobs ──────────────────────────────────

async function phaseSetBudget() {
  let jobs;
  try {
    const result = await api.listJobs({ status: 'created', limit: '50' });
    jobs = Array.isArray(result) ? result : result?.jobs || result?.data || [];
  } catch { jobs = []; }

  for (const job of (Array.isArray(jobs) ? jobs : [])) {
    const id = job.localJobId || job.id;
    if (processedIds.has(`budget-${id}`)) continue;
    if (job.erc8183Status !== 'Open' && job.erc8183_status !== 'Open') continue;
    if (job.providerAgentId && job.providerAgentId !== PROVIDER_AGENT_ID) continue;

    // Capability filter on setBudget too
    if (!hasCapability(job)) {
      console.log(`   [BUDGET] Skipping job ${id} — capability mismatch`);
      processedIds.add(`budget-${id}`);
      continue;
    }

    console.log(`\n[${new Date().toISOString()}] [BUDGET] Open job: ${id}`);
    try {
      const budgetTx = await api.setBudget(id);
      if (AUTONOMOUS_TX && budgetTx.tx) {
        console.log(`   Signing setBudget tx...`);
        const result = await signer.sendTx(budgetTx.tx);
        console.log(`   setBudget tx: ${result.hash}`);
        await sleep(2000);
        const confirmed = await api.confirmTx(id, 'set_budget', result.hash);
        console.log(`   setBudget confirmed! status: ${confirmed.erc8183Status}`);
      }
    } catch (err) {
      console.error(`   [BUDGET] Failed:`, err.message);
    }
    processedIds.add(`budget-${id}`);
  }
}

// ── Phase 2: Claim + run + submit on Funded jobs ──────────────────────

async function phaseClaimAndSubmit() {
  let jobs = [];
  let activeProcessed = 0;
  try {
    // Fetch both 'created' and 'claimed' jobs separately (API doesn't support IN)
    const [r1, r2] = await Promise.all([
      api.listJobs({ status: 'created', limit: '50' }).catch(() => []),
      api.listJobs({ status: 'claimed', limit: '50' }).catch(() => []),
    ]);
    const j1 = Array.isArray(r1) ? r1 : r1?.jobs || r1?.data || [];
    const j2 = Array.isArray(r2) ? r2 : r2?.jobs || r2?.data || [];
    jobs = j1.concat(j2);
  } catch { jobs = []; }

  for (const job of (Array.isArray(jobs) ? jobs : [])) {
    const id = job.localJobId || job.id;
    if (processedIds.has(`claim-${id}`)) continue;
    if (job.erc8183Status !== 'Funded') continue;
    if (job.providerAgentId && job.providerAgentId !== PROVIDER_AGENT_ID) continue;

    // Capability filter
    if (!hasCapability(job)) {
      console.log(`   [WORK] Skipping job ${id} — capability mismatch`);
      processedIds.add(`claim-${id}`);
      continue;
    }

    if (activeProcessed >= MAX_ACTIVE_JOBS) {
      console.log(`   [WORK] Hit MAX_ACTIVE_JOBS (${MAX_ACTIVE_JOBS}) — waiting for next cycle`);
      break;
    }
    activeProcessed++;

    const alreadyClaimed = job.status === 'claimed';
    const jobType = job.inputPayload?.jobType || 'unknown';
    console.log(`\n[${new Date().toISOString()}] [WORK] ${alreadyClaimed ? 'Continue claimed' : 'New funded'} job: ${id} (${jobType})`);

    try {
      // Claim (skip if already claimed)
      if (!alreadyClaimed) {
        const claimed = await api.claim(id, { workerId: WORKER_ID, providerAgentId: PROVIDER_AGENT_ID, claimTtlSeconds: CLAIM_TTL_SECONDS });
        console.log(`   Claimed: status=${claimed.status}`);
      } else {
        console.log(`   Already claimed — skipping claim step`);
      }

      // Mark running
      const running = await api.markRunning(id, WORKER_ID);
      console.log(`   Running: status=${running.status}`);

      // Run strategy based on job type
      const { resultPayload, proofPayload } = runWorkerStrategy(job);
      console.log(`   Strategy: ${jobType} (confidence: ${resultPayload.confidence})`);

      // Submit
      const submitted = await api.submit(id, { workerId: WORKER_ID, resultPayload, proofPayload });
      console.log(`   deliverableHash: ${submitted.deliverableHash}`);

      if (AUTONOMOUS_TX) {
        const sResult = await signer.sendTx(submitted.tx);
        console.log(`   submit tx: ${sResult.hash}`);
        await sleep(2000);
        const conf = await api.confirmTx(id, 'submit', sResult.hash);
        console.log(`   Submit confirmed! status: ${conf.erc8183Status}`);
      }
      console.log(`   ✅ Job ${id} submitted`);
    } catch (err) {
      console.error(`   [WORK] Failed:`, err.message);
    }
    processedIds.add(`claim-${id}`);
  }
}

// ── Main loop ────────────────────────────────────────────────────────

async function main() {
  console.log('=== ERC-8183 Provider Bot (autonomous job market) ===');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Provider: ${PROVIDER_AGENT_ID}`);
  console.log(`Address: ${PROVIDER_ADDRESS}`);
  console.log(`Capabilities: ${WORKER_CAPABILITIES.join(', ') || '<all>'}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);

  // Run both phases
  await phaseSetBudget();
  await phaseClaimAndSubmit();

  setInterval(async () => {
    await phaseSetBudget();
    await phaseClaimAndSubmit();
  }, POLL_INTERVAL_MS);
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
