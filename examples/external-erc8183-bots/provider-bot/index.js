/**
 * Provider bot — two-phase ERC-8183 job worker.
 *
 * Phase 1: Set budget on open jobs (provider must set price on-chain)
 * Phase 2: Claim + run + submit on funded jobs
 */
require('dotenv').config({ path: __dirname + '/.env' });

const api = require('../shared/erc8183-http-client');
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
const POLL_INTERVAL_MS = parseInt(process.env.JOB_POLL_INTERVAL_MS || '5000', 10);
const AUTONOMOUS_TX = process.env.AUTONOMOUS_TX === 'true';
const CLAIM_TTL_SECONDS = parseInt(process.env.CLAIM_TTL_SECONDS || '600', 10);
const MAX_ACTIVE_JOBS = parseInt(process.env.MAX_ACTIVE_JOBS || '3', 10);

const signer = createSigner({ privateKey: PROVIDER_PK, rpcUrl: ARC_RPC_URL });
console.log(`Provider signer address: ${signer.address}`);

const processedIds = new Set();

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
    if (activeProcessed >= MAX_ACTIVE_JOBS) {
      console.log(`   [WORK] Hit MAX_ACTIVE_JOBS (${MAX_ACTIVE_JOBS}) — waiting for next cycle`);
      break;
    }
    activeProcessed++;

    const alreadyClaimed = job.status === 'claimed';
    console.log(`\n[${new Date().toISOString()}] [WORK] ${alreadyClaimed ? 'Continue claimed' : 'New funded'} job: ${id}`);

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

      // Echo deliverable
      const resultPayload = { workerId: WORKER_ID, status: 'completed', summary: 'Echo from provider bot.', processedAt: new Date().toISOString(), runId: crypto.randomUUID() };
      const proofPayload = { runtime: 'pm2', durationMs: 500, model: 'rules-echo', provider: PROVIDER_AGENT_ID };

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
  console.log('=== ERC-8183 Provider Bot (two-phase) ===');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Provider: ${PROVIDER_AGENT_ID}`);
  console.log(`Address: ${PROVIDER_ADDRESS}`);

  // Run both phases
  await phaseSetBudget();
  await phaseClaimAndSubmit();

  setInterval(async () => {
    await phaseSetBudget();
    await phaseClaimAndSubmit();
  }, POLL_INTERVAL_MS);
}

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
