/**
 * Provider bot — two-phase ERC-8183 job provider with capability-based strategy.
 *
 * Phase 1: Set budget on open jobs (provider must set price on-chain)
 * Phase 2: Claim + run + submit on funded jobs
 *
 * Jobs are matched by inputPayload.requiredCapability against PROVIDER_CAPABILITIES.
 * Results are structured per jobType instead of static echo.
 *
 * Stability: every per-job error is caught and logged — one bad job never
 * kills the poll loop. Stale/broken jobs are cached in skippedJobIds so they
 * are not retried every cycle.
 *
 * v2 hardening:
 *   - Durable provider state file (survives PM2 restart)
 *   - Per-job error backoff with configurable thresholds
 *   - Custom skill safety scanner integration
 *   - Health diagnostics in heartbeat
 *   - Idempotency guards from persisted state
 */
require('dotenv').config({ path: __dirname + '/.env' });

const api = require('../shared/erc8183-http-client');
api.setRole('provider');
const { createSigner } = require('../shared/tx-signer');
const { required, requiredAddress, normalizePrivateKey } = require('../shared/env');
const { sleep } = require('../shared/sleep');
const { startHeartbeat } = require('../shared/heartbeat');
const crypto = require('crypto');
const { runLlmTask } = require('./task-runner');
const { createProviderState } = require('./provider-state');
const { getLastCustomSkillValidation, loadProviderSkills } = require('./skill-loader');

const BASE_URL = required('ARCLAYER_BASE_URL');

const PROVIDER_AGENT_ID = required('PROVIDER_AGENT_ID');

const PROVIDER_ADDRESS = (() => {
  const addr = process.env.PROVIDER_ADDRESS;
  if (!addr) throw new Error('Missing required env: PROVIDER_ADDRESS');
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) throw new Error('PROVIDER_ADDRESS must be a valid 0x address');
  return addr;
})();

const PROVIDER_PK = (() => {
  const pk = process.env.PROVIDER_PRIVATE_KEY;
  if (!pk) throw new Error('Missing required env: PROVIDER_PRIVATE_KEY');
  return normalizePrivateKey(pk);
})();

const ARC_RPC_URL = required('ARC_RPC_URL');
const POLL_INTERVAL_MS = parseInt(process.env.JOB_POLL_INTERVAL_MS || '60000', 10);
const AUTONOMOUS_TX = process.env.AUTONOMOUS_TX === 'true';
const CLAIM_TTL_SECONDS = parseInt(process.env.CLAIM_TTL_SECONDS || '600', 10);
const MAX_ACTIVE_JOBS = parseInt(process.env.MAX_ACTIVE_JOBS || '3', 10);
const MIN_JOB_BUDGET_ATOMIC = parseInt(process.env.MIN_JOB_BUDGET_ATOMIC || '0', 10);

// ── Provider mode ────────────────────────────────────────────────────────
const PROVIDER_MODE = (process.env.PROVIDER_MODE || 'template').toLowerCase();
const PROVIDER_AGENT_TYPE = process.env.PROVIDER_AGENT_TYPE || '';

// ── IGNORE_JOBS_BEFORE — numeric ERC-8183 job id threshold ──────────────
// If set, skip any job with erc8183JobId < this value.
const IGNORE_JOBS_BEFORE = process.env.IGNORE_JOBS_BEFORE || '';

// ── REQUIRE_ASSIGNED_PROVIDER — reject jobs not assigned to this provider ──
const REQUIRE_ASSIGNED_PROVIDER = process.env.REQUIRE_ASSIGNED_PROVIDER === 'true';

// ── Durable state file ──────────────────────────────────────────────────
const PROVIDER_STATE_FILE = process.env.PROVIDER_STATE_FILE || __dirname + '/provider-state.json';

// ── Per-job error backoff ───────────────────────────────────────────────
const JOB_ERROR_BACKOFF_MS = parseInt(process.env.PROVIDER_JOB_ERROR_BACKOFF_MS || '60000', 10);
const MAX_JOB_ERRORS = parseInt(process.env.PROVIDER_MAX_JOB_ERRORS || '3', 10);

// ── Health diagnostics tracking ─────────────────────────────────────────
let lastLoopAt = null;
let lastErrorAt = null;
let lastErrorCode = null;
let processedJobsCount = 0;
let polling = false; // Prevent overlapping poll cycles

// ── LLM config (validated at startup if PROVIDER_MODE=llm) ──────────────
const LLM_CONFIG = (() => {
  if (PROVIDER_MODE !== 'llm') return null;

  const provider = process.env.LLM_PROVIDER || '';
  const baseUrl = process.env.LLM_BASE_URL || '';
  const apiKey = process.env.LLM_API_KEY || '';
  const model = process.env.LLM_MODEL || '';
  const maxTokens = parseInt(process.env.LLM_MAX_TOKENS || '2500', 10);
  const temperature = parseFloat(process.env.LLM_TEMPERATURE || '0.2');
  const timeoutMs = parseInt(process.env.LLM_TIMEOUT_MS || '60000', 10);
  const jsonRepairRetries = parseInt(process.env.LLM_JSON_REPAIR_RETRIES || '1', 10);

  // Validate required LLM env
  const errors = [];
  if (!provider) errors.push('LLM_PROVIDER');
  if (!baseUrl) errors.push('LLM_BASE_URL');
  if (!model) errors.push('LLM_MODEL');
  // LLM_API_KEY required unless provider is local/no-auth
  const isLocalAuth = provider === 'local' || provider === 'no-auth';
  if (!apiKey && !isLocalAuth) errors.push('LLM_API_KEY');

  if (errors.length > 0) {
    throw new Error(
      `PROVIDER_MODE=llm requires: ${errors.join(', ')}. ` +
      `Set these in .env or switch PROVIDER_MODE=template.`
    );
  }

  return { provider, baseUrl, apiKey, model, maxTokens, temperature, timeoutMs, jsonRepairRetries };
})();

// ── Provider capabilities ────────────────────────────────────────────────
const PROVIDER_CAPABILITIES = (process.env.PROVIDER_CAPABILITIES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// ── Provider skill config ───────────────────────────────────────────────
const PROVIDER_SKILL = (process.env.PROVIDER_SKILL || 'auto').trim();
const PROVIDER_CUSTOM_SKILL_PATH = (process.env.PROVIDER_CUSTOM_SKILL_PATH || '').trim();

const signer = createSigner({ privateKey: PROVIDER_PK, rpcUrl: ARC_RPC_URL });
console.log(`Provider signer address: ${signer.address}`);

// ── Initialize durable state ────────────────────────────────────────────
const providerState = createProviderState(PROVIDER_STATE_FILE);

// ── Heartbeat with health diagnostics ───────────────────────────────────
const stopHeartbeat = startHeartbeat({
  agentId: PROVIDER_AGENT_ID,
  role: 'provider',
  apiKey: required('PROVIDER_API_KEY'),
  baseUrl: BASE_URL,
  processName: 'arclayer-erc8183-provider',
  chainId: parseInt(process.env.ARC_CHAIN_ID || '5042002', 10),
  getDiagnostics() {
    const counts = providerState.getCounts();
    const skillValidation = getLastCustomSkillValidation();
    return {
      lastLoopAt,
      lastErrorAt: lastErrorAt || counts.lastErrorAt,
      lastErrorCode: lastErrorCode || counts.lastErrorCode,
      skippedJobsCount: counts.skippedJobsCount,
      processedJobsCount,
      repairCount: counts.repairCount,
      providerState: (lastErrorAt && Date.now() - lastErrorAt < 120_000) ? 'degraded' : 'healthy',
      customSkillConfigured: skillValidation?.configured || false,
      customSkillScannerPass: skillValidation?.scannerPass ?? true,
    };
  },
});

if (PROVIDER_CAPABILITIES.length > 0) {
  console.log(`Provider capabilities: ${PROVIDER_CAPABILITIES.join(', ')}`);
} else {
  console.log(`Provider capabilities: <none> — will accept all jobs`);
}

if (IGNORE_JOBS_BEFORE) {
  console.log(`IGNORE_JOBS_BEFORE: ${IGNORE_JOBS_BEFORE} (skip jobs with erc8183JobId < ${IGNORE_JOBS_BEFORE})`);
}

if (REQUIRE_ASSIGNED_PROVIDER) {
  console.log(`REQUIRE_ASSIGNED_PROVIDER: true — unassigned jobs will be permanently skipped`);
}

console.log(`Provider state file: ${PROVIDER_STATE_FILE}`);
console.log(`Job error backoff: ${JOB_ERROR_BACKOFF_MS}ms, max errors per job: ${MAX_JOB_ERRORS}`);

// ── Per-process caches (supplement to durable state) ─────────────────────
const processedIds = new Set();
const skippedJobIds = new Set();

// ── Helpers ─────────────────────────────────────────────────────────────

/** Extract a safe error message — never leaks keys or internals. */
function getSafeErrorMessage(err) {
  let msg = err?.shortMessage || err?.details || err?.message || String(err);
  // Sanitize potential secret leaks from API error bodies
  msg = msg.replace(/(ak_|sk_|pk:|Bearer |PRIVATE_KEY=|API_KEY=)[^\s,;)}\]]+/gi, '$1<redacted>');
  msg = msg.replace(/0x[a-fA-F0-9]{64,}/gi, '0x<redacted>');
  return msg;
}

/** Mark a job as permanently skipped for this process lifetime AND durable state. */
function rememberSkippedJob(job, reason) {
  const key = job.localJobId || job.id || job.erc8183JobId;
  if (!key) return;
  skippedJobIds.add(String(key));
  if (job.erc8183JobId) skippedJobIds.add(String(job.erc8183JobId));
  // Persist to durable state
  providerState.skipJob(key, reason);
  if (job.erc8183JobId) providerState.skipJob(job.erc8183JobId, reason);
  console.warn(`   [skip] job ${key}: ${reason}`);
}

/** Check if a job has been marked as skipped (memory + durable state). */
function isSkippedJob(job) {
  const localId = job.localJobId || job.id;
  const ercId = job.erc8183JobId;
  return (
    (localId && (skippedJobIds.has(String(localId)) || providerState.isSkipped(localId) || providerState.isBadJob(localId))) ||
    (ercId && (skippedJobIds.has(String(ercId)) || providerState.isSkipped(ercId) || providerState.isBadJob(ercId)))
  );
}

/**
 * Check if a job should be backed off due to repeated errors.
 * Returns true if the job should be skipped (still in backoff window or max errors exceeded).
 */
function shouldBackoffJob(job) {
  const key = job.localJobId || job.id || job.erc8183JobId;
  if (!key) return false;

  // Check if job was already submitted or budget-set (idempotency from durable state)
  if (providerState.wasSubmitted(key) || providerState.wasSubmitted(job.erc8183JobId)) {
    return true;
  }

  const errors = providerState.getJobErrors(key);
  if (!errors) return false;

  // Max errors exceeded — mark as bad and skip permanently
  if (errors.count >= MAX_JOB_ERRORS) {
    providerState.markBadJob(key, `max errors (${MAX_JOB_ERRORS}) exceeded`);
    rememberSkippedJob(job, `max errors exceeded (${errors.count}/${MAX_JOB_ERRORS})`);
    return true;
  }

  // Backoff window check
  if (errors.lastAt && (Date.now() - errors.lastAt) < JOB_ERROR_BACKOFF_MS) {
    return true; // Still in backoff
  }

  return false;
}

/**
 * Resolve the budget amount from a job, following client-driven priority.
 * Returns 0 if no valid budget is found.
 */
function resolveJobBudget(job) {
  const candidates = [
    job.budgetAtomic,
    job.budget,
    job.inputPayload?.budgetAtomic,
    job.inputPayload?.budget,
    job.priceAtomic,
    job.amount,
  ];
  for (const c of candidates) {
    if (c === undefined || c === null || c === '') continue;
    const n = parseInt(String(c), 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 0;
}

// ── Capability filter ────────────────────────────────────────────────────

function hasCapability(job) {
  const inputPayload = job.inputPayload || {};
  const req = inputPayload.requiredCapability;
  if (!req || req === '') return true; // no requirement = accept
  return PROVIDER_CAPABILITIES.length === 0 || PROVIDER_CAPABILITIES.includes(req);
}

/**
 * Check whether this job is assigned to this provider.
 * Verifies providerAgentId match and (if available) provider address match.
 */
function isAssignedToThisProvider(job) {
  // providerAgentId must match
  if (job.providerAgentId && String(job.providerAgentId) !== String(PROVIDER_AGENT_ID)) {
    return false;
  }
  // provider address must match if available
  const jobProviderAddr = job.providerAddress || job.participants?.provider?.address;
  if (jobProviderAddr && jobProviderAddr.toLowerCase() !== PROVIDER_ADDRESS.toLowerCase()) {
    return false;
  }
  return true;
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
    providerAgentId: PROVIDER_AGENT_ID,
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

// ── On-chain status names ──────────────────────────────────────────────
const ONCHAIN_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'];

// ── Phase 1: Set budget on Open jobs ──────────────────────────────────

async function phaseSetBudget() {
  let jobs;
  try {
    const result = await api.listJobs({ status: 'created', limit: '50' });
    jobs = Array.isArray(result) ? result : result?.jobs || result?.data || [];
  } catch { jobs = []; }

  for (const job of (Array.isArray(jobs) ? jobs : [])) {
    const id = job.localJobId || job.id;
    const erc8183JobId = job.erc8183JobId;

    try {
      // ── Skip cache (memory + durable) ──
      if (isSkippedJob(job)) continue;
      if (processedIds.has(`budget-${id}`)) continue;

      // ── Idempotency: skip if already setBudget in durable state ──
      if (providerState.wasSetBudget(id) || (erc8183JobId && providerState.wasSetBudget(erc8183JobId))) {
        processedIds.add(`budget-${id}`);
        continue;
      }

      // ── Backoff check ──
      if (shouldBackoffJob(job)) continue;

      // ── Guard: IGNORE_JOBS_BEFORE (numeric job id threshold) ──
      if (IGNORE_JOBS_BEFORE && erc8183JobId) {
        if (Number(erc8183JobId) < Number(IGNORE_JOBS_BEFORE)) {
          console.log(`   [filter] skipping old job ${erc8183JobId} due to IGNORE_JOBS_BEFORE=${IGNORE_JOBS_BEFORE}`);
          processedIds.add(`budget-${id}`);
          rememberSkippedJob(job, `older than IGNORE_JOBS_BEFORE=${IGNORE_JOBS_BEFORE}`);
          continue;
        }
      }

      // ── Guard: assigned provider match ──
      if (!isAssignedToThisProvider(job)) {
        processedIds.add(`budget-${id}`);
        if (REQUIRE_ASSIGNED_PROVIDER) {
          rememberSkippedJob(job, 'wrong providerAgentId or providerAddress');
        }
        continue;
      }

      // ── Guard: capability match ──
      if (!hasCapability(job)) {
        processedIds.add(`budget-${id}`);
        continue;
      }

      // ── Guard: local DB status checks ──
      // Skip if already has setBudgetTxHash
      if (job.setBudgetTxHash) {
        processedIds.add(`budget-${id}`);
        providerState.recordSetBudget(id);
        if (erc8183JobId) providerState.recordSetBudget(erc8183JobId);
        continue;
      }
      // Skip if lifecycleStatus is already past Open
      const localStatus = job.lifecycleStatus || job.erc8183Status || job.erc8183_status || '';
      if (localStatus && localStatus !== 'Open' && localStatus !== 'CreatedOnchain') {
        processedIds.add(`budget-${id}`);
        continue;
      }

      if (!erc8183JobId) {
        processedIds.add(`budget-${id}`);
        continue;
      }

      // ── Guard: client-budget-driven validation ──
      const clientBudget = resolveJobBudget(job);
      if (clientBudget <= 0) {
        console.log(`   [budget] skip job ${id}: missing client budget`);
        processedIds.add(`budget-${id}`);
        rememberSkippedJob(job, 'missing client budget');
        continue;
      }
      if (MIN_JOB_BUDGET_ATOMIC > 0 && clientBudget < MIN_JOB_BUDGET_ATOMIC) {
        console.log(`   [budget] skip job ${id}: budget ${clientBudget} below minimum ${MIN_JOB_BUDGET_ATOMIC}`);
        processedIds.add(`budget-${id}`);
        rememberSkippedJob(job, `budget ${clientBudget} below minimum`);
        continue;
      }

      // ── Guard: ON-CHAIN verification before setBudget ──
      let onchainJob;
      try {
        onchainJob = await signer.readJob(erc8183JobId);
      } catch { onchainJob = null; }

      if (!onchainJob) {
        processedIds.add(`budget-${id}`);
        continue;
      }

      if (onchainJob.status !== 0) {
        processedIds.add(`budget-${id}`);
        continue;
      }

      if (onchainJob.budget > 0n) {
        processedIds.add(`budget-${id}`);
        continue;
      }

      // ── All guards passed — call setBudget with client budget ──
      console.log(`\n[${new Date().toISOString()}] [BUDGET] Open job: ${id} (erc8183=${erc8183JobId}, onchain=Open, budget=0)`);
      console.log(`   [budget] using client budget: ${clientBudget}`);

      if (AUTONOMOUS_TX) {
        const budgetTx = await api.setBudget(id);
        if (budgetTx.tx) {
          console.log(`   Signing setBudget tx...`);
          const result = await signer.sendTx(budgetTx.tx);
          console.log(`   setBudget tx: ${result.hash}`);
          await sleep(2000);
          const confirmed = await api.confirmTx(id, 'set_budget', result.hash);
          console.log(`   [budget] setBudget confirmed! status: ${confirmed.erc8183Status}`);

          // Record in durable state for idempotency
          providerState.recordSetBudget(id);
          if (erc8183JobId) providerState.recordSetBudget(erc8183JobId);
        }
      }

      processedIds.add(`budget-${id}`);
    } catch (err) {
      const safeReason = getSafeErrorMessage(err);
      console.error(`   [BUDGET] Failed job ${id}: ${safeReason}`);
      lastErrorAt = Date.now();
      lastErrorCode = 'BUDGET_ERROR';

      // Record error for backoff — do NOT rememberSkippedJob here.
      // Transient failures (API, RPC, LLM) must be retried after backoff.
      // Only shouldBackoffJob() persists permanent skip when max errors exceeded.
      providerState.recordJobError(id, 'BUDGET_ERROR');
      providerState.recordError('BUDGET_ERROR');

      processedIds.add(`budget-${id}`);
      // Continue to next job — do NOT throw out of poll loop
    }
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

    try {
      if (isSkippedJob(job)) continue;
      if (processedIds.has(`claim-${id}`)) continue;

      // IGNORE_JOBS_BEFORE filter (numeric job id threshold)
      if (IGNORE_JOBS_BEFORE && job.erc8183JobId) {
        if (Number(job.erc8183JobId) < Number(IGNORE_JOBS_BEFORE)) {
          processedIds.add(`claim-${id}`);
          continue;
        }
      }

      if (job.erc8183Status !== 'Funded') continue;

      // Assigned provider guard
      if (!isAssignedToThisProvider(job)) {
        processedIds.add(`claim-${id}`);
        if (REQUIRE_ASSIGNED_PROVIDER) {
          rememberSkippedJob(job, 'wrong providerAgentId or providerAddress');
        }
        continue;
      }

      // Capability filter
      if (!hasCapability(job)) {
        processedIds.add(`claim-${id}`);
        continue;
      }

      // MIN_JOB_BUDGET_ATOMIC guard
      if (MIN_JOB_BUDGET_ATOMIC > 0) {
        const jobBudget = resolveJobBudget(job);
        if (jobBudget < MIN_JOB_BUDGET_ATOMIC) {
          console.log(`   [WORK] Skipping job ${id} — budget ${jobBudget} < min ${MIN_JOB_BUDGET_ATOMIC}`);
          processedIds.add(`claim-${id}`);
          continue;
        }
      }

      // ── Idempotency: skip if already submitted in durable state ──
      if (providerState.wasSubmitted(id) || (job.erc8183JobId && providerState.wasSubmitted(job.erc8183JobId))) {
        processedIds.add(`claim-${id}`);
        continue;
      }

      // ── Backoff check ──
      if (shouldBackoffJob(job)) continue;

      if (activeProcessed >= MAX_ACTIVE_JOBS) {
        console.log(`   [WORK] Hit MAX_ACTIVE_JOBS (${MAX_ACTIVE_JOBS}) — waiting for next cycle`);
        break;
      }
      activeProcessed++;

      const alreadyClaimed = job.status === 'claimed';
      const jobType = job.inputPayload?.jobType || 'unknown';
      console.log(`\n[${new Date().toISOString()}] [WORK] ${alreadyClaimed ? 'Continue claimed' : 'New funded'} job: ${id} (${jobType})`);

      // Claim (skip if already claimed)
      if (!alreadyClaimed) {
        const claimed = await api.claim(id, { providerAgentId: PROVIDER_AGENT_ID, claimTtlSeconds: CLAIM_TTL_SECONDS });
        console.log(`   Claimed: status=${claimed.status}`);
      } else {
        console.log(`   Already claimed — skipping claim step`);
      }

      // Mark running
      const running = await api.markRunning(id, PROVIDER_AGENT_ID);
      console.log(`   Running: status=${running.status}`);

      // Run strategy based on provider mode
      let resultPayload;
      let proofPayload;
      let strategy;

      if (PROVIDER_MODE === 'llm') {
        strategy = `llm:${LLM_CONFIG.model}`;
        const llmEnv = {
          baseUrl: LLM_CONFIG.baseUrl,
          apiKey: LLM_CONFIG.apiKey,
          model: LLM_CONFIG.model,
          provider: LLM_CONFIG.provider,
          agentType: PROVIDER_AGENT_TYPE || 'other',
          providerAgentId: PROVIDER_AGENT_ID,
          capabilities: PROVIDER_CAPABILITIES,
          maxTokens: LLM_CONFIG.maxTokens,
          temperature: LLM_CONFIG.temperature,
          timeoutMs: LLM_CONFIG.timeoutMs,
          providerSkill: PROVIDER_SKILL,
          customSkillPath: PROVIDER_CUSTOM_SKILL_PATH,
          jsonRepairRetries: LLM_CONFIG.jsonRepairRetries,
        };
        const result = await runLlmTask(job, llmEnv);
        resultPayload = result.resultPayload;
        proofPayload = result.proofPayload;

        // Track repair usage in durable state
        if (proofPayload?.repairUsed) {
          providerState.incrementRepair();
        }
      } else {
        strategy = `template:${jobType}`;
        const result = runWorkerStrategy(job);
        resultPayload = result.resultPayload;
        proofPayload = result.proofPayload;
      }
      console.log(`   Strategy: ${strategy} (confidence: ${resultPayload.confidence})${proofPayload?.repairUsed ? ' [repair used]' : ''}`);

      // Submit
      const submitted = await api.submit(id, { providerAgentId: PROVIDER_AGENT_ID, resultPayload, proofPayload });
      console.log(`   deliverableHash: ${submitted.deliverableHash}`);

      if (AUTONOMOUS_TX) {
        const sResult = await signer.sendTx(submitted.tx);
        console.log(`   submit tx: ${sResult.hash}`);
        await sleep(2000);
        const conf = await api.confirmTx(id, 'submit', sResult.hash);
        console.log(`   Submit confirmed! status: ${conf.erc8183Status}`);
      }

      // Record success in durable state
      providerState.recordSubmit(id);
      if (job.erc8183JobId) providerState.recordSubmit(job.erc8183JobId);
      providerState.clearJobErrors(id);
      processedJobsCount++;

      console.log(`   ✅ Job ${id} submitted`);
    } catch (err) {
      const safeReason = getSafeErrorMessage(err);
      console.error(`   [WORK] Failed job ${id}: ${safeReason}`);
      lastErrorAt = Date.now();
      lastErrorCode = 'WORK_ERROR';

      // Record error for backoff — do NOT rememberSkippedJob here.
      // Transient failures (API, RPC, LLM, submit) must be retried after backoff.
      // Only shouldBackoffJob() persists permanent skip when max errors exceeded.
      providerState.recordJobError(id, 'WORK_ERROR');
      providerState.recordError('WORK_ERROR');
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
  console.log(`Mode: ${PROVIDER_MODE}${PROVIDER_AGENT_TYPE ? ` (${PROVIDER_AGENT_TYPE})` : ''}`);
  if (PROVIDER_MODE === 'llm') {
    console.log(`LLM: ${LLM_CONFIG.provider} / ${LLM_CONFIG.model}`);
    console.log(`LLM timeout: ${LLM_CONFIG.timeoutMs}ms, maxTokens: ${LLM_CONFIG.maxTokens}, jsonRepairRetries: ${LLM_CONFIG.jsonRepairRetries}`);
  }
  console.log(`Capabilities: ${PROVIDER_CAPABILITIES.join(', ') || '<all>'}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);
  if (MIN_JOB_BUDGET_ATOMIC > 0) {
    console.log(`Min job budget: ${MIN_JOB_BUDGET_ATOMIC} atomic`);
  }

  // Eagerly load skills at startup (validates custom skill path + scanner)
  if (PROVIDER_MODE === 'llm') {
    loadProviderSkills({
      agentType: PROVIDER_AGENT_TYPE || 'other',
      providerSkill: PROVIDER_SKILL,
      customSkillPath: PROVIDER_CUSTOM_SKILL_PATH,
    });
  }

  // Log custom skill status
  const skillValidation = getLastCustomSkillValidation();
  if (skillValidation) {
    console.log(`Custom skill configured: ${skillValidation.configured ? 'yes' : 'no'}`);
    if (skillValidation.configured) {
      console.log(`Custom skill file: ${skillValidation.basename} (${skillValidation.size} bytes)`);
      console.log(`Custom skill scanner: ${skillValidation.scannerPass ? 'PASS' : 'FAIL'}`);
    }
  }

  // Run both phases — wrapped so one phase error does not kill startup
  try { await phaseSetBudget(); } catch (err) {
    console.error(`[FATAL] phaseSetBudget startup error: ${getSafeErrorMessage(err)}`);
  }
  try { await phaseClaimAndSubmit(); } catch (err) {
    console.error(`[FATAL] phaseClaimAndSubmit startup error: ${getSafeErrorMessage(err)}`);
  }

  lastLoopAt = Date.now();

  setInterval(async () => {
    if (polling) {
      console.warn(`[POLL] Previous cycle still running — skipping this tick`);
      return;
    }
    polling = true;
    try {
      await phaseSetBudget();
    } catch (err) {
      console.error(`[POLL] phaseSetBudget error: ${getSafeErrorMessage(err)}`);
      lastErrorAt = Date.now();
      lastErrorCode = 'POLL_BUDGET_ERROR';
    }
    try {
      await phaseClaimAndSubmit();
    } catch (err) {
      console.error(`[POLL] phaseClaimAndSubmit error: ${getSafeErrorMessage(err)}`);
      lastErrorAt = Date.now();
      lastErrorCode = 'POLL_WORK_ERROR';
    }
    lastLoopAt = Date.now();
    polling = false;
  }, POLL_INTERVAL_MS);
}

// Save state on exit
process.on('SIGINT', () => { providerState.stop(); process.exit(0); });
process.on('SIGTERM', () => { providerState.stop(); process.exit(0); });

main().catch((err) => { console.error('Fatal:', err.message); process.exit(1); });
