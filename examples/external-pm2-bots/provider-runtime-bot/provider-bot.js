#!/usr/bin/env node
/**
 * Provider Runtime Bot — PM2-managed provider agent for ERC-8183 jobs.
 *
 * PR #461: Durable runtime memory, direct assigned jobs, open/global job discovery.
 *
 * Features:
 * - Crash-safe: all state persisted via ArcLayer runtime memory
 * - Resume: reads checkpoint + on-chain state on restart
 * - Direct assigned jobs: setBudget → wait funding → submit → wait evaluator
 * - Open/global jobs: list → apply → wait client setProvider → continue
 * - Never calls setProvider (client-only onchain action)
 * - Private key stays local, never sent to ArcLayer
 *
 * Security:
 * - No private key logging
 * - No private key in MCP calls
 * - Address validation before signing
 */

const { ArclayerMcpClient } = require('./shared/arclayer-mcp-client');

// ── Env Validation ────────────────────────────────────────────────────────

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[FATAL] Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function optionalEnv(name, fallback) {
  return process.env[name] || fallback;
}

// Validate startup env
const BASE_URL = requireEnv('ARCLAYER_BASE_URL');
const MCP_TOKEN = requireEnv('ARCLAYER_MCP_TOKEN');
const AGENT_ID = requireEnv('ARCLAYER_AGENT_ID');
const PROVIDER_ADDRESS = requireEnv('PROVIDER_ADDRESS');
const PRIVATE_KEY = optionalEnv('PROVIDER_PRIVATE_KEY', '');
const AUTO_APPLY = optionalEnv('PROVIDER_AUTO_APPLY_OPEN_JOBS', 'false') === 'true';
const MAX_QUOTE_USDC = optionalEnv('PROVIDER_MAX_QUOTE_USDC', '');
const CAPABILITIES = optionalEnv('PROVIDER_CAPABILITIES', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const POLL_INTERVAL = parseInt(optionalEnv('POLL_INTERVAL_MS', '15000'), 10);

// ── Client ────────────────────────────────────────────────────────────────

const client = new ArclayerMcpClient({
  baseUrl: BASE_URL,
  token: MCP_TOKEN,
  agentId: AGENT_ID,
});

// ── Transaction Signing ───────────────────────────────────────────────────

/**
 * Sign and send a transaction using viem locally.
 * Private key NEVER leaves this machine.
 *
 * The MCP prepare tools return pre-encoded calldata: { to, data, value }.
 * We send them directly — no re-encoding.
 */
async function signAndSendTx(txInstruction) {
  if (!PRIVATE_KEY) {
    throw new Error('PROVIDER_PRIVATE_KEY not set — cannot sign transactions');
  }

  // MCP tools return { to, data, value } — pre-encoded calldata
  const to = txInstruction.to;
  const data = txInstruction.data;
  if (!to || !data) {
    throw new Error(`Invalid tx instruction: missing to/data. Keys: ${Object.keys(txInstruction).join(', ')}`);
  }

  // Dynamic import viem (ESM)
  const { createWalletClient, http } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const { arcTestnet } = await import('viem/chains');

  const account = privateKeyToAccount(PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(),
  });

  // Send pre-encoded calldata directly
  const hash = await walletClient.sendTransaction({
    to,
    data,
  });

  console.log(`[TX] Sent: ${hash}`);
  return hash;
}

// ── Phase Handlers ────────────────────────────────────────────────────────

/**
 * Handle a direct assigned job where provider = this bot's address.
 */
async function handleDirectJob(jobId, resumePlan) {
  const onchainStatus = resumePlan.onchainStatus;
  const phase = resumePlan.lastCheckpoint?.phase;

  console.log(`[DIRECT] Job ${jobId}: onchain=${onchainStatus}, phase=${phase}`);

  if (onchainStatus === 'Open') {
    if (phase === 'budget_tx_failed') {
      console.log(`[DIRECT] Retrying setBudget for job ${jobId}`);
    }

    // Set budget
    const budgetUsdc = MAX_QUOTE_USDC || '1.0';
    console.log(`[DIRECT] Setting budget: ${budgetUsdc} USDC for job ${jobId}`);

    const txData = await client.prepareSetBudget(jobId, budgetUsdc);

    await client.writeCheckpoint(jobId, {
      phase: 'budget_tx_sent',
      status: 'tx_sent',
      note: `setBudget ${budgetUsdc} USDC`,
    });

    try {
      const txHash = await signAndSendTx(txData);
      await client.writeCheckpoint(jobId, {
        phase: 'budget_tx_sent',
        status: 'tx_sent',
        txHash,
        note: `setBudget tx: ${txHash}`,
      });

      // Wait for confirmation (simplified — production should poll receipt)
      await client.writeCheckpoint(jobId, {
        phase: 'budget_confirmed',
        status: 'confirmed',
        txHash,
        note: 'Budget set. Waiting for client to fund.',
      });

      console.log(`[DIRECT] Budget set for job ${jobId}: ${txHash}`);
    } catch (err) {
      await client.writeCheckpoint(jobId, {
        phase: 'budget_tx_failed',
        status: 'failed',
        note: `setBudget failed: ${err.message}`,
      });
      console.error(`[DIRECT] setBudget failed for job ${jobId}:`, err.message);
    }
    return;
  }

  if (onchainStatus === 'Funded') {
    if (phase === 'submit_tx_failed') {
      console.log(`[DIRECT] Retrying submit for job ${jobId}`);
    }

    // Prepare deliverable (placeholder — real bot would generate actual deliverable)
    const deliverableHash = '0x' + '0'.repeat(64); // placeholder
    console.log(`[DIRECT] Submitting deliverable for job ${jobId}`);

    try {
      const txData = await client.prepareSubmitJob(jobId, deliverableHash);

      await client.writeCheckpoint(jobId, {
        phase: 'submit_tx_sent',
        status: 'tx_sent',
        deliverableHash,
        note: 'Submit tx sent',
      });

      const txHash = await signAndSendTx(txData);

      await client.writeCheckpoint(jobId, {
        phase: 'submitted_confirmed',
        status: 'confirmed',
        txHash,
        deliverableHash,
        note: `Submit confirmed: ${txHash}`,
      });

      console.log(`[DIRECT] Submitted deliverable for job ${jobId}: ${txHash}`);
    } catch (err) {
      await client.writeCheckpoint(jobId, {
        phase: 'submit_tx_failed',
        status: 'failed',
        note: `Submit failed: ${err.message}`,
      });
      console.error(`[DIRECT] Submit failed for job ${jobId}:`, err.message);
    }
    return;
  }

  if (onchainStatus === 'Submitted') {
    console.log(`[DIRECT] Job ${jobId}: waiting for evaluator`);
    return;
  }

  if (onchainStatus === 'Completed' || onchainStatus === 'Rejected' || onchainStatus === 'Expired') {
    const terminalPhase = `${onchainStatus.toLowerCase()}_detected`;
    await client.writeCheckpoint(jobId, {
      phase: terminalPhase,
      status: 'terminal',
      note: `Job ${onchainStatus}`,
    });
    console.log(`[DIRECT] Job ${jobId} terminal: ${onchainStatus}`);
    return;
  }

  console.log(`[DIRECT] Job ${jobId}: unexpected state ${onchainStatus}`);
}

/**
 * Discover and optionally apply to open/global jobs.
 */
async function discoverOpenJobs() {
  console.log('[OPEN] Listing open/global jobs...');

  const result = await client.listOpenJobs({ limit: 20 });
  const jobs = result.jobs || [];

  console.log(`[OPEN] Found ${jobs.length} open jobs`);

  if (!AUTO_APPLY) {
    if (jobs.length > 0) {
      console.log(`[OPEN] Auto-apply disabled. ${jobs.length} jobs available.`);
    }
    return;
  }

  // Get existing applications to avoid duplicates
  const myApps = await client.listMyApplications('submitted');
  const appliedJobIds = new Set((myApps.applications || []).map((a) => a.job_id));

  for (const job of jobs) {
    const jobId = String(job.jobId ?? job.job_id ?? job.id);

    if (appliedJobIds.has(jobId)) {
      console.log(`[OPEN] Already applied to job ${jobId}, skipping`);
      continue;
    }

    // Filter by budget if configured
    if (MAX_QUOTE_USDC) {
      const budget = Number(job.budget ?? job.budgetAtomic ?? 0) / 1e6;
      if (budget > 0 && budget < Number(MAX_QUOTE_USDC)) {
        console.log(`[OPEN] Job ${jobId} budget ${budget} USDC < max quote ${MAX_QUOTE_USDC}, skipping`);
        continue;
      }
    }

    // Check expiry
    const expiredAt = job.expiredAt ?? job.expired_at;
    if (expiredAt && Number(expiredAt) > 0 && Number(expiredAt) < Date.now() / 1000) {
      console.log(`[OPEN] Job ${jobId} expired, skipping`);
      continue;
    }

    console.log(`[OPEN] Applying to job ${jobId}...`);

    try {
      const result = await client.applyOpenJob(jobId, PROVIDER_ADDRESS, {
        quoteAmountUsdc: MAX_QUOTE_USDC || undefined,
        capabilities: CAPABILITIES.length > 0 ? CAPABILITIES : undefined,
        message: `Provider ${AGENT_ID} applying via runtime bot`,
      });

      // Write checkpoint
      await client.startJobRun(jobId, 'applied_to_open_job');
      await client.writeCheckpoint(jobId, {
        phase: 'applied_to_open_job',
        status: 'applied',
        note: `Applied. Application ID: ${result.applicationId}`,
      });

      console.log(`[OPEN] Applied to job ${jobId}: ${result.applicationId}`);
    } catch (err) {
      console.error(`[OPEN] Failed to apply to job ${jobId}:`, err.message);
    }
  }
}

/**
 * Discover direct-assigned jobs where provider = this bot's address.
 * These are jobs created by a client with provider already set.
 */
async function discoverDirectJobs() {
  console.log('[DIRECT] Checking for direct-assigned jobs...');

  try {
    const result = await client.listAssignedJobs(PROVIDER_ADDRESS);
    const jobs = result.jobs || [];

    if (jobs.length === 0) {
      console.log('[DIRECT] No direct-assigned jobs found');
      return;
    }

    console.log(`[DIRECT] Found ${jobs.length} direct-assigned job(s)`);

    // Get existing active runs to avoid duplicates
    const context = await client.getContext(PROVIDER_ADDRESS);
    if (context.activeRun) {
      console.log(`[DIRECT] Already have active run for job ${context.activeRun.job_id}, skipping discovery`);
      return;
    }

    // Start a run for the first direct-assigned job
    const job = jobs[0];
    const jobId = String(job.jobId ?? job.job_id ?? job.id);

    console.log(`[DIRECT] Starting run for direct-assigned job ${jobId}`);
    await client.startJobRun(jobId, 'budget_tx_sent');
    await client.writeCheckpoint(jobId, {
      phase: 'open_job_found',
      status: 'discovered',
      note: `Direct-assigned job discovered: provider=${PROVIDER_ADDRESS}`,
    });
  } catch (err) {
    console.error('[DIRECT] Discovery error:', err.message);
  }
}

// ── Main Loop ─────────────────────────────────────────────────────────────

let running = true;
let processedJobIds = new Set();

async function pollCycle() {
  try {
    // 1. Heartbeat
    await client.heartbeat();

    // 2. Get resume plan (with provider address for verification)
    const context = await client.getContext(PROVIDER_ADDRESS);
    const resumePlan = context.resumePlan;

    if (resumePlan && context.activeRun) {
      const jobId = context.activeRun.job_id;

      if (resumePlan.terminal) {
        console.log(`[POLL] Active job ${jobId} is terminal: ${resumePlan.reason}`);
        processedJobIds.add(jobId);
      } else if (resumePlan.providerAssigned) {
        // Direct assigned job — handle it
        await handleDirectJob(jobId, resumePlan);
      } else if (resumePlan.nextAction === 'wait_for_client_setProvider') {
        console.log(`[POLL] Job ${jobId}: waiting for client to assign provider`);
      } else if (resumePlan.nextAction === 'wait_for_client_funding') {
        console.log(`[POLL] Job ${jobId}: waiting for client to fund`);
      } else if (resumePlan.nextAction === 'wait_for_evaluator') {
        console.log(`[POLL] Job ${jobId}: waiting for evaluator`);
      } else {
        console.log(`[POLL] Job ${jobId}: next=${resumePlan.nextAction}, tool=${resumePlan.recommendedTool}`);
      }
    } else {
      // No active job — check direct-assigned jobs first, then open jobs
      await discoverDirectJobs();
      // Only check open jobs if still no active run after direct discovery
      const recheck = await client.getContext(PROVIDER_ADDRESS);
      if (!recheck.activeRun) {
        await discoverOpenJobs();
      }
    }
  } catch (err) {
    console.error(`[POLL] Cycle error:`, err.message);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Provider Runtime Bot v1 (PR #461)');
  console.log(`  Agent: ${AGENT_ID}`);
  console.log(`  Address: ${PROVIDER_ADDRESS}`);
  console.log(`  Auto-apply: ${AUTO_APPLY}`);
  console.log(`  Poll interval: ${POLL_INTERVAL}ms`);
  console.log('═══════════════════════════════════════════════════════════════');

  // Startup: heartbeat + context + resume plan
  try {
    console.log('[STARTUP] Sending heartbeat...');
    await client.heartbeat();
    console.log('[STARTUP] Heartbeat OK');

    console.log('[STARTUP] Getting context...');
    const context = await client.getContext(PROVIDER_ADDRESS);
    console.log(`[STARTUP] Runtime state: ${context.runtimeState?.status || 'none'}`);
    console.log(`[STARTUP] Active run: ${context.activeRun?.job_id || 'none'}`);
    console.log(`[STARTUP] Active applications: ${context.activeApplications?.length || 0}`);

    if (context.resumePlan) {
      console.log(`[STARTUP] Resume plan: ${context.resumePlan.nextAction}`);
      console.log(`[STARTUP] Reason: ${context.resumePlan.reason}`);
    }
  } catch (err) {
    console.error(`[FATAL] Startup failed — runtime memory unavailable: ${err.message}`);
    console.error('[FATAL] Exiting non-zero so PM2 restarts');
    process.exit(1);
  }

  // Main poll loop
  while (running) {
    await pollCycle();
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

// ── Graceful Shutdown ─────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received');
  running = false;
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received');
  running = false;
});

process.on('unhandledRejection', (err) => {
  console.error('[ERROR] Unhandled rejection:', err);
});

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
