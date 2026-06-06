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
const { validateLlmConfig, runLlmTaskForJob } = require('./llm-task-helper');
const crypto = require('crypto');

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

// ── LLM Config (validated at startup — required) ───────────────────────────
const LLM_CONFIG = validateLlmConfig(process.env);

// ── Address Validation (fail-fast at startup) ──────────────────────────────
// privateKeyToAccount is synchronous — validate immediately
if (PRIVATE_KEY) {
  try {
    const { privateKeyToAccount: _pkCheck } = require('viem/accounts');
    const derived = _pkCheck(PRIVATE_KEY).address;
    if (derived.toLowerCase() !== PROVIDER_ADDRESS.toLowerCase()) {
      console.error(`[FATAL] PROVIDER_PRIVATE_KEY address (${derived}) does not match PROVIDER_ADDRESS (${PROVIDER_ADDRESS})`);
      process.exit(1);
    }
    console.log(`[STARTUP] Key address verified: ${derived}`);
  } catch (e) {
    console.error(`[FATAL] Key validation failed: ${e.message}`);
    process.exit(1);
  }
}

// ── Bot Config (passed to LLM task runner) ─────────────────────────────────
const BOT_CONFIG = {
  agentId: AGENT_ID,
  agentType: optionalEnv('PROVIDER_AGENT_TYPE', 'other'),
  capabilities: CAPABILITIES,
  providerSkill: optionalEnv('PROVIDER_SKILL', 'auto'),
  customSkillPath: optionalEnv('PROVIDER_CUSTOM_SKILL_PATH', ''),
};

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

  // Validate private key address matches PROVIDER_ADDRESS
  const { privateKeyToAccount: _pk2a } = await import('viem/accounts');
  const derivedAddr = _pk2a(PRIVATE_KEY).address;
  if (derivedAddr.toLowerCase() !== PROVIDER_ADDRESS.toLowerCase()) {
    throw new Error(
      `[SECURITY] PROVIDER_PRIVATE_KEY address (${derivedAddr}) does not match PROVIDER_ADDRESS (${PROVIDER_ADDRESS}). Aborting.`
    );
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
    transport: http('https://arc-testnet.drpc.org'),
  });

  // Send pre-encoded calldata directly (value defaults to 0n for setBudget/submit)
  const value = txInstruction.value ? BigInt(txInstruction.value) : 0n;
  const hash = await walletClient.sendTransaction({
    to,
    data,
    value,
  });

  console.log(`[TX] Sent: ${hash}`);
  return hash;
}

// ── Phase Handlers ────────────────────────────────────────────────────────

/**
 * Handle a direct assigned job where provider = this bot's address.
 *
 * Resume-safe:
 * - If deliverable_ready checkpoint exists with stored hash → reuse it
 * - If submit_tx_sent → check onchain before retrying
 * - LLM failure → runtime_failed checkpoint → no submit
 */
async function handleDirectJob(jobId, resumePlan) {
  const onchainStatus = resumePlan.onchainStatus;
  const phase = resumePlan.lastCheckpoint?.phase;
  const lastCheckpoint = resumePlan.lastCheckpoint;

  // Create publicClient for receipt checks (with drpc fallback)
  const { createPublicClient, http } = await import('viem');
  const { arcTestnet } = await import('viem/chains');
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http('https://arc-testnet.drpc.org'),
  });

  console.log(`[DIRECT] Job ${jobId}: onchain=${onchainStatus}, phase=${phase}`);

  // ── Open: set budget ────────────────────────────────────────────────────
  if (onchainStatus === 'Open') {
    // Already confirmed budget — waiting for client to fund
    if (phase === 'budget_confirmed') {
      console.log(`[DIRECT] Job ${jobId}: budget confirmed, waiting for client to fund`);
      return;
    }

    // Already sent budget tx — check receipt before retrying
    if (phase === 'budget_tx_sent') {
      const txHash = lastCheckpoint?.metadata?.txHash || lastCheckpoint?.tx_hash;
      console.log(`[DIRECT] Job ${jobId}: budget tx already sent (${txHash}), checking receipt...`);
      if (txHash) {
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
          if (receipt) {
            if (receipt.status === 'success') {
              console.log(`[DIRECT] Job ${jobId}: setBudget tx confirmed! Writing budget_confirmed checkpoint`);
              await client.writeCheckpoint(jobId, {
                phase: 'budget_confirmed',
                status: 'confirmed',
                txHash,
                note: `setBudget confirmed onchain: ${txHash}`,
                metadata: { txHash },
              });
              return;
            } else {
              console.error(`[DIRECT] Job ${jobId}: setBudget tx REVERTED`);
              await client.writeCheckpoint(jobId, {
                phase: 'budget_tx_failed',
                status: 'failed',
                note: `setBudget reverted: ${txHash}`,
                metadata: { txHash },
              });
              // Fall through to retry
            }
          } else {
            // No receipt yet — check age
            const sentAt = lastCheckpoint?.created_at ? new Date(lastCheckpoint.created_at).getTime() : 0;
            const ageMs = Date.now() - sentAt;
            if (ageMs > 5 * 60 * 1000) {
              console.error(`[DIRECT] Job ${jobId}: setBudget tx dropped after ${Math.round(ageMs / 1000)}s, will retry`);
              await client.writeCheckpoint(jobId, {
                phase: 'budget_tx_failed',
                status: 'failed',
                note: `setBudget tx dropped after ${Math.round(ageMs / 1000)}s`,
                metadata: { txHash },
              });
              // Fall through to retry
            } else {
              console.log(`[DIRECT] Job ${jobId}: setBudget tx ${txHash} still pending (${Math.round(ageMs / 1000)}s)`);
              return;
            }
          }
        } catch (err) {
          console.warn(`[DIRECT] Job ${jobId}: receipt check failed: ${err.message}, will retry next cycle`);
          return;
        }
      }
      return;
    }

    if (phase === 'budget_tx_failed') {
      console.log(`[DIRECT] Retrying setBudget for job ${jobId}`);
    }

    const budgetUsdc = MAX_QUOTE_USDC || '1.0';
    console.log(`[DIRECT] Setting budget: ${budgetUsdc} USDC for job ${jobId}`);

    const txData = await client.prepareSetBudget(jobId, budgetUsdc);

    try {
      const txHash = await signAndSendTx(txData);

      await client.writeCheckpoint(jobId, {
        phase: 'budget_tx_sent',
        status: 'tx_sent',
        txHash,
        note: `setBudget tx sent: ${txHash}`,
        metadata: { txHash },
      });

      console.log(`[DIRECT] setBudget tx sent for job ${jobId}: ${txHash}`);
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

  // ── Funded: run LLM + submit ─────────────────────────────────────────────
  if (onchainStatus === 'Funded') {
    // Guard: if submit_tx_sent, check receipt before retrying
    if (phase === 'submit_tx_sent') {
      const txHash = lastCheckpoint?.metadata?.txHash || lastCheckpoint?.tx_hash;
      const submittedAt = lastCheckpoint?.created_at ? new Date(lastCheckpoint.created_at).getTime() : 0;
      const ageMs = Date.now() - submittedAt;
      const TX_RECEIPT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

      if (!txHash) {
        // No txHash stored — checkpoint was incomplete, retry submit
        console.warn(`[DIRECT] Job ${jobId}: submit_tx_sent but no txHash in checkpoint — will retry`);
        // Fall through to deliverable_ready / LLM execution below
      } else if (ageMs < TX_RECEIPT_TIMEOUT_MS) {
        // Recent tx — check receipt
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: txHash });

          if (receipt) {
            if (receipt.status === 'success') {
              // Tx confirmed — next poll should detect onchain Submitted
              console.log(`[DIRECT] Job ${jobId}: submit tx ${txHash} confirmed onchain`);
              return;
            } else {
              // Tx reverted — mark failed, allow retry
              console.error(`[DIRECT] Job ${jobId}: submit tx ${txHash} REVERTED`);
              await client.writeCheckpoint(jobId, {
                phase: 'submit_tx_failed',
                status: 'failed',
                note: `Submit tx reverted: ${txHash}`,
                metadata: { txHash, receiptStatus: receipt.status },
              });
              return;
            }
          }
          // No receipt yet — tx still pending, wait
          console.log(`[DIRECT] Job ${jobId}: submit tx ${txHash} pending (${Math.round(ageMs / 1000)}s)`);
          return;
        } catch (err) {
          // RPC error — can't check receipt, wait for next poll
          console.warn(`[DIRECT] Job ${jobId}: receipt check failed: ${err.message}`);
          return;
        }
      } else {
        // Tx older than timeout and still no onchain Submitted — likely dropped
        console.error(`[DIRECT] Job ${jobId}: submit tx ${txHash} timed out after ${Math.round(ageMs / 1000)}s`);
        await client.writeCheckpoint(jobId, {
          phase: 'submit_tx_failed',
          status: 'failed',
          note: `Submit tx timed out after ${Math.round(ageMs / 1000)}s — may have been dropped`,
          metadata: { txHash, ageMs },
        });
        return;
      }
    }

    // Guard: if runtime_failed, don't retry LLM in the same run
    if (phase === 'runtime_failed') {
      console.log(`[DIRECT] Job ${jobId}: runtime_failed — LLM execution failed. Manual intervention needed.`);
      return;
    }

    // Check if we already have a deliverableHash from a previous run (resume case)
    let deliverableHash = null;
    let resultPayload = null;
    let proofPayload = null;

    if (phase === 'deliverable_ready' || phase === 'runtime_completed') {
      // Resume: extract deliverableHash from checkpoint metadata
      const metadata = lastCheckpoint?.metadata || {};
      deliverableHash = metadata.deliverableHash || lastCheckpoint?.deliverable_hash;
      if (deliverableHash) {
        console.log(`[DIRECT] Job ${jobId}: reusing deliverableHash from checkpoint: ${deliverableHash.slice(0, 18)}...`);
      }
    }

    // If no deliverableHash yet, run LLM
    if (!deliverableHash) {
      // Fetch full job detail for LLM
      let jobDetail;
      try {
        jobDetail = await client.getJob(jobId);
        if (!jobDetail) throw new Error('Job not found');
      } catch (err) {
        console.error(`[DIRECT] Job ${jobId}: failed to fetch job detail: ${err.message}`);
        await client.writeCheckpoint(jobId, {
          phase: 'runtime_failed',
          status: 'failed',
          note: `Failed to fetch job detail: ${err.message}`,
        });
        return;
      }

      // Normalize job shape for runLlmTask
      const normalizedJob = {
        id: jobId,
        localJobId: jobId,
        erc8183JobId: jobId,
        description: jobDetail.description || jobDetail.inputPayload?.description || '',
        inputPayload: jobDetail.inputPayload || {},
        budgetAtomic: jobDetail.budgetAtomic || jobDetail.budget || '',
      };

      // Write runtime_started checkpoint
      await client.writeCheckpoint(jobId, {
        phase: 'runtime_started',
        status: 'running',
        note: `LLM execution started: ${LLM_CONFIG.model}`,
        metadata: { model: LLM_CONFIG.model, provider: LLM_CONFIG.provider },
      });
      console.log(`[DIRECT] Job ${jobId}: running LLM task (${LLM_CONFIG.model})...`);

      try {
        const result = await runLlmTaskForJob(normalizedJob, LLM_CONFIG, BOT_CONFIG);
        resultPayload = result.resultPayload;
        proofPayload = result.proofPayload;
        deliverableHash = result.deliverableHash;

        // Write runtime_completed checkpoint
        await client.writeCheckpoint(jobId, {
          phase: 'runtime_completed',
          status: 'completed',
          note: `LLM completed: confidence=${resultPayload.confidence}, hash=${deliverableHash.slice(0, 18)}...`,
          metadata: {
            deliverableHash,
            confidence: resultPayload.confidence,
            model: LLM_CONFIG.model,
            provider: LLM_CONFIG.provider,
            runtime: 'llm',
            createdAt: new Date().toISOString(),
          },
        });
        console.log(`[DIRECT] Job ${jobId}: LLM completed, confidence=${resultPayload.confidence}`);
      } catch (err) {
        // LLM failure — do NOT submit
        await client.writeCheckpoint(jobId, {
          phase: 'runtime_failed',
          status: 'failed',
          note: `LLM execution failed: ${err.message}`,
          metadata: { model: LLM_CONFIG.model, provider: LLM_CONFIG.provider },
        });
        console.error(`[DIRECT] Job ${jobId}: LLM failed: ${err.message}`);
        return; // Do not proceed to submit
      }

      // Write deliverable_ready checkpoint (stores hash for resume)
      await client.writeCheckpoint(jobId, {
        phase: 'deliverable_ready',
        status: 'ready',
        deliverableHash,
        note: `Deliverable ready: ${deliverableHash.slice(0, 18)}...`,
        metadata: {
          deliverableHash,
          confidence: resultPayload.confidence,
          model: LLM_CONFIG.model,
          provider: LLM_CONFIG.provider,
          runtime: 'llm',
          createdAt: new Date().toISOString(),
        },
      });
    }

    // Submit the deliverable
    console.log(`[DIRECT] Submitting deliverable for job ${jobId}: ${deliverableHash.slice(0, 18)}...`);

    try {
      const txData = await client.prepareSubmitJob(jobId, deliverableHash);

      const txHash = await signAndSendTx(txData);

      // Write ONLY submit_tx_sent — do NOT write submitted_confirmed
      await client.writeCheckpoint(jobId, {
        phase: 'submit_tx_sent',
        status: 'tx_sent',
        txHash,
        deliverableHash,
        note: `Submit tx sent: ${txHash}`,
        metadata: { txHash, deliverableHash },
      });

      console.log(`[DIRECT] Submit tx sent for job ${jobId}: ${txHash}`);
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

  // ── Submitted: wait for evaluator ────────────────────────────────────────
  if (onchainStatus === 'Submitted') {
    if (phase !== 'submitted_detected') {
      await client.writeCheckpoint(jobId, {
        phase: 'submitted_detected',
        status: 'confirmed',
        note: 'Onchain status is Submitted. Waiting for evaluator.',
      });
    }
    console.log(`[DIRECT] Job ${jobId}: waiting for evaluator`);
    return;
  }

  // ── Terminal states ──────────────────────────────────────────────────────
  if (onchainStatus === 'Completed' || onchainStatus === 'Rejected' || onchainStatus === 'Expired') {
    const terminalPhase = `${onchainStatus.toLowerCase()}_detected`;
    if (phase !== terminalPhase) {
      await client.writeCheckpoint(jobId, {
        phase: terminalPhase,
        status: 'terminal',
        note: `Job ${onchainStatus}`,
      });
    }
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
 * Checks Open, Funded, and Submitted statuses — catches jobs at any active phase.
 */
async function discoverDirectJobs(skipJobIds = new Set()) {
  console.log('[DIRECT] Checking for direct-assigned jobs...');

  try {
    const result = await client.listAssignedJobs(PROVIDER_ADDRESS);
    console.log('[DIRECT] MCP response:', JSON.stringify(result).slice(0, 300));
    const jobs = result.jobs || [];

    if (jobs.length === 0) {
      console.log('[DIRECT] No direct-assigned jobs found');
      return;
    }

    console.log(`[DIRECT] Found ${jobs.length} direct-assigned job(s)`);

    // Filter out already-processed jobs AND jobs with active runs
    // Also skip jobs with terminal onchain statuses (Completed=3, Rejected=4, Expired=5)
    const TERMINAL_STATUSES = new Set(['completed', 'rejected', 'expired', '3', '4', '5']);
    const newJobs = jobs.filter((j) => {
      const jid = String(j.jobId ?? j.job_id ?? j.id);
      const st = String(j.status || '').toLowerCase();
      if (processedJobIds.has(jid) || skipJobIds.has(jid)) return false;
      if (TERMINAL_STATUSES.has(st)) {
        processedJobIds.add(jid); // remember for future cycles
        return false;
      }
      return true;
    });

    if (newJobs.length === 0) {
      console.log('[DIRECT] All discovered jobs already processed');
      return;
    }

    // Start a run for the first new direct-assigned job
    const job = newJobs[0];
    const jobId = String(job.jobId ?? job.job_id ?? job.id);
    const status = String(job.status || '').toLowerCase();

    // Determine initial phase based on on-chain status
    let initialPhase = 'budget_tx_sent'; // Open → need setBudget
    if (status === 'funded' || status === '1') {
      initialPhase = 'funded_detected'; // Funded → need submit
    } else if (status === 'submitted' || status === '2') {
      initialPhase = 'submitted_confirmed'; // Submitted → wait evaluator
    }

    console.log(`[DIRECT] Starting run for job ${jobId} (onchain status: ${status})`);
    const runResult = await client.startJobRun(jobId, initialPhase);
    console.log(`[DIRECT] startJobRun result:`, JSON.stringify(runResult).slice(0, 200));

    // If the run is already terminal (completed/failed), skip it
    if (runResult.runStatus === 'completed' || runResult.runStatus === 'failed') {
      console.log(`[DIRECT] Job ${jobId} run already ${runResult.runStatus}, skipping`);
      processedJobIds.add(jobId);
      return;
    }

    await client.writeCheckpoint(jobId, {
      phase: 'open_job_found',
      status: 'discovered',
      note: `Direct-assigned job discovered: provider=${PROVIDER_ADDRESS}, onchain_status=${status}`,
    });
  } catch (err) {
    console.error('[DIRECT] Discovery error:', err.message);
  }
}

// ── Main Loop ─────────────────────────────────────────────────────────────

let running = true;
let processedJobIds = new Set();

// Production guard: max active runs (default 1)
const MAX_ACTIVE_RUNS = parseInt(process.env.PROVIDER_MAX_ACTIVE_RUNS || '1', 10);

// Phases that allow discovery (terminal or failed)
const DISCOVERY_ALLOWED_PHASES = new Set([
  'completed_detected',
  'runtime_completed',
  'runtime_failed',
  'submit_tx_failed',
  'budget_tx_failed',
  'expired_detected',
  'rejected_detected',
  'cancelled_detected',
]);

function isDiscoveryAllowed(context) {
  // No active run → discovery allowed
  if (!context.activeRun) return true;

  // Active run with terminal resume plan → discovery allowed
  if (context.resumePlan?.terminal) return true;

  // Active run with discovery-allowed phase → discovery allowed
  const phase = context.activeRun.phase || '';
  if (DISCOVERY_ALLOWED_PHASES.has(phase)) return true;

  // Non-terminal active run → BLOCK discovery
  return false;
}

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
        // Clear the run from runtime state so getContext returns null next time
        try {
          await client.completeRun(jobId, context.activeRun.id);
          console.log(`[POLL] Completed run for terminal job ${jobId}`);
        } catch (err) {
          console.warn(`[POLL] Failed to complete run for ${jobId}: ${err.message}`);
        }
        // Fall through to discovery — terminal run is now cleared
      } else if (resumePlan.providerAssignedToThisBot) {
        // Direct assigned job — check if actionable or just waiting
        if (resumePlan.nextAction === 'wait_for_client_funding' || resumePlan.nextAction === 'wait_for_evaluator') {
          // Expiry guard: if onchain expiredAt has passed, release provider from stuck state
          try {
            const status = await client.getOnchainStatus(jobId);
            const expiredAt = Number(status?.expiredAt || 0);
            if (expiredAt > 0 && expiredAt < Date.now() / 1000) {
              console.log(`[DIRECT] Job ${jobId} expired while waiting for funding. Releasing provider run.`);
              await client.writeCheckpoint(jobId, {
                phase: 'expired_detected',
                status: 'terminal',
                note: `Job expired onchain at ${new Date(expiredAt * 1000).toISOString()}. Provider released.`,
              });
              processedJobIds.add(jobId);
              try {
                await client.completeRun(jobId, context.activeRun.id);
                console.log(`[POLL] Completed run for expired job ${jobId}`);
              } catch (err) {
                console.warn(`[POLL] Failed to complete run for expired ${jobId}: ${err.message}`);
              }
              return; // fall through to discovery on next cycle
            }
          } catch (checkErr) {
            console.warn(`[POLL] Expiry check failed for ${jobId}: ${checkErr.message}`);
          }
          console.log(`[POLL] Job ${jobId}: ${resumePlan.nextAction} — waiting (no discovery while active)`);
          return; // BLOCK discovery — active non-terminal run exists
        } else {
          // Actionable — handle it
          await handleDirectJob(jobId, resumePlan);
          return; // handled, don't discover
        }
      } else if (resumePlan.nextAction === 'wait_for_client_setProvider') {
        console.log(`[POLL] Job ${jobId}: waiting for client to assign provider`);
        return; // waiting, don't discover
      } else {
        console.log(`[POLL] Job ${jobId}: next=${resumePlan.nextAction}, tool=${resumePlan.recommendedTool}`);
        return; // unknown, don't discover
      }
    }

    // Discovery guard: only discover if allowed
    if (!isDiscoveryAllowed(context)) {
      console.log(`[POLL] Discovery blocked — active run in phase ${context.activeRun?.phase}`);
      return;
    }

    // No active job OR active job is terminal — discover new jobs
    // Skip the active job ID to avoid re-discovering it
    const skipIds = new Set();
    if (context.activeRun?.job_id) skipIds.add(context.activeRun.job_id);
    await discoverDirectJobs(skipIds);
    // Only check open jobs if still no active run after direct discovery
    const recheck = await client.getContext(PROVIDER_ADDRESS);
    if (!recheck.activeRun) {
      await discoverOpenJobs();
    }
  } catch (err) {
    console.error(`[POLL] Cycle error:`, err.message);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Provider Runtime Bot v2 (PR #461 — LLM-backed)');
  console.log(`  Agent: ${AGENT_ID}`);
  console.log(`  Address: ${PROVIDER_ADDRESS}`);
  console.log(`  Auto-apply: ${AUTO_APPLY}`);
  console.log(`  LLM: ${LLM_CONFIG.provider} / ${LLM_CONFIG.model}`);
  console.log(`  LLM timeout: ${LLM_CONFIG.timeoutMs}ms, maxTokens: ${LLM_CONFIG.maxTokens}`);
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
