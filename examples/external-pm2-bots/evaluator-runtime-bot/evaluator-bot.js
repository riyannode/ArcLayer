#!/usr/bin/env node
/**
 * Evaluator Runtime Bot — PM2-managed evaluator agent for ERC-8183 jobs.
 *
 * Live mode: discovers Submitted jobs assigned to EVALUATOR_ADDRESS,
 * runs real LLM evaluation, signs complete/reject on-chain.
 *
 * Security:
 * - Dedicated evaluator EOA (never client/provider/main wallet)
 * - Policy guard: only complete() and reject() allowed
 * - No private key logging
 * - Checkpoint prevents duplicate transactions
 * - On-chain evaluator verification before signing
 */

const { ArclayerMcpClient } = require('./shared/arclayer-mcp-client');
const { EvaluatorSigner } = require('./shared/evaluator-signer');
const { EvaluatorCheckpoint } = require('./shared/evaluator-checkpoint');
const { evaluateJob } = require('./evaluator-engine');
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

// ── Required Env ──────────────────────────────────────────────────────────

const BASE_URL = requireEnv('ARCLAYER_BASE_URL');
const MCP_TOKEN = requireEnv('ARCLAYER_MCP_TOKEN');
const EVALUATOR_ADDRESS = requireEnv('EVALUATOR_ADDRESS');
const EVALUATOR_PRIVATE_KEY = requireEnv('EVALUATOR_PRIVATE_KEY');
const SIGNER_MODE = optionalEnv('EVALUATOR_SIGNER_MODE', 'legacy-eoa');
const NETWORK = optionalEnv('ARCLAYER_NETWORK', 'arc-testnet');

// ── LLM Config ───────────────────────────────────────────────────────────

const LLM_PROVIDER = optionalEnv('LLM_PROVIDER', 'openai');
const LLM_BASE_URL = requireEnv('LLM_BASE_URL');
const LLM_API_KEY = optionalEnv('LLM_API_KEY', '') || optionalEnv('OPENAI_API_KEY', '');
if (!LLM_API_KEY) {
  console.error('[FATAL] Missing required env: LLM_API_KEY or OPENAI_API_KEY');
  process.exit(1);
}
const LLM_MODEL = optionalEnv('EVALUATOR_MODEL', optionalEnv('LLM_MODEL', 'gpt-4.1-mini'));
const LLM_MAX_TOKENS = parseInt(optionalEnv('LLM_MAX_TOKENS', '2000'), 10);
const LLM_TEMPERATURE = parseFloat(optionalEnv('LLM_TEMPERATURE', '0.1'));
const LLM_TIMEOUT_MS = parseInt(optionalEnv('LLM_TIMEOUT_MS', '60000'), 10);

// ── Evaluator Config ─────────────────────────────────────────────────────

const POLL_INTERVAL = parseInt(optionalEnv('POLL_INTERVAL_MS', '15000'), 10);
const AUTO_COMPLETE = optionalEnv('EVALUATOR_AUTO_COMPLETE', 'true') === 'true';
const AUTO_REJECT = optionalEnv('EVALUATOR_AUTO_REJECT', 'true') === 'true';
const MIN_CONFIDENCE = parseFloat(optionalEnv('EVALUATOR_MIN_CONFIDENCE', '0.80'));
const MAX_JOBS_PER_LOOP = parseInt(optionalEnv('EVALUATOR_MAX_JOBS_PER_LOOP', '3'), 10);

// ── Contract Address (from SDK) ──────────────────────────────────────────

// Read from env or use the canonical Arc Testnet address
const CONTRACT_ADDRESS = optionalEnv(
  'ERC8183_CONTRACT_ADDRESS',
  '0x0747EEf0706327138c69792bF28Cd525089e4583'
);

// ── Startup Validation ───────────────────────────────────────────────────

console.log('[STARTUP] Evaluator Runtime Bot starting...');
console.log(`[STARTUP] Network: ${NETWORK}`);
console.log(`[STARTUP] Signer mode: ${SIGNER_MODE}`);
console.log(`[STARTUP] Evaluator: ${EVALUATOR_ADDRESS}`);
console.log(`[STARTUP] LLM: ${LLM_PROVIDER}/${LLM_MODEL}`);
console.log(`[STARTUP] Auto-complete: ${AUTO_COMPLETE}, Auto-reject: ${AUTO_REJECT}`);
console.log(`[STARTUP] Min confidence: ${MIN_CONFIDENCE}, Max jobs/loop: ${MAX_JOBS_PER_LOOP}`);
console.log(`[STARTUP] Poll interval: ${POLL_INTERVAL}ms`);

// Validate signer mode
if (SIGNER_MODE !== 'legacy-eoa') {
  console.error(`[FATAL] EVALUATOR_SIGNER_MODE="${SIGNER_MODE}" is not configured. Only legacy-eoa is supported.`);
  process.exit(1);
}

// ── Initialize Components ────────────────────────────────────────────────

const client = new ArclayerMcpClient({
  baseUrl: BASE_URL,
  token: MCP_TOKEN,
  agentId: '', // evaluator doesn't need agentId for MCP calls
});

const signer = new EvaluatorSigner({
  signerMode: SIGNER_MODE,
  evaluatorAddress: EVALUATOR_ADDRESS,
  privateKey: EVALUATOR_PRIVATE_KEY,
  contractAddress: CONTRACT_ADDRESS,
  chainId: 5042002,
});

const checkpoint = new EvaluatorCheckpoint();

const LLM_CONFIG = {
  baseUrl: LLM_BASE_URL,
  apiKey: LLM_API_KEY,
  model: LLM_MODEL,
  maxTokens: LLM_MAX_TOKENS,
  temperature: LLM_TEMPERATURE,
  timeoutMs: LLM_TIMEOUT_MS,
  provider: LLM_PROVIDER,
};

// ── Graceful Shutdown ────────────────────────────────────────────────────

let running = true;

function shutdown(signal) {
  console.log(`[SHUTDOWN] Received ${signal}, stopping...`);
  running = false;
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── On-Chain Evaluator Verification ──────────────────────────────────────

/**
 * Verify that the on-chain evaluator for a job matches EVALUATOR_ADDRESS.
 * Returns true if match, false otherwise.
 */
async function verifyOnchainEvaluator(jobId) {
  try {
    const onchain = await client.getOnchainJob(jobId);
    if (!onchain) {
      console.warn(`[VERIFY] Job ${jobId}: could not read on-chain state`);
      return false;
    }

    const onchainEvaluator = (onchain.evaluator || '').toLowerCase();
    const expected = EVALUATOR_ADDRESS.toLowerCase();

    if (onchainEvaluator !== expected) {
      console.warn(
        `[VERIFY] Job ${jobId}: on-chain evaluator ${onchainEvaluator} != expected ${expected}`
      );
      return false;
    }

    return true;
  } catch (err) {
    console.warn(`[VERIFY] Job ${jobId}: on-chain check failed: ${err.message}`);
    return false;
  }
}

// ── Job Processing ───────────────────────────────────────────────────────

/**
 * Process a single Submitted job.
 */
async function processJob(job) {
  const jobId = String(job.id || job.jobId);

  // Check checkpoint state
  const existingCheckpoint = checkpoint.getJob(jobId);

  if (existingCheckpoint) {
    // Skip if already terminal
    if (checkpoint.isTerminal(jobId)) {
      return;
    }

    // Skip if tx pending
    if (checkpoint.hasPendingOrConfirmedTx(jobId)) {
      // But check if tx is actually confirmed on-chain
      const phase = checkpoint.getPhase(jobId);
      if (phase === 'complete_tx_sent' || phase === 'reject_tx_sent') {
        const txHash = existingCheckpoint.txHash;
        if (txHash) {
          try {
            const { createPublicClient, http } = await import('viem');
            const { arcTestnet } = await import('viem/chains');
            const publicClient = createPublicClient({
              chain: arcTestnet,
              transport: http('https://arc-testnet.drpc.org'),
            });
            const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
            if (receipt) {
              const newPhase = phase.replace('_sent', '_confirmed');
              checkpoint.updateJob(jobId, {
                phase: newPhase,
                txStatus: receipt.status,
                confirmedAt: new Date().toISOString(),
              });
              console.log(`[EVAL] Job ${jobId}: tx ${txHash} confirmed (${receipt.status})`);
            }
          } catch {
            // Still pending
          }
        }
      }
      return;
    }
  }

  // Mark as seen
  checkpoint.updateJob(jobId, {
    phase: 'submitted_seen',
    lastSeenStatus: 'Submitted',
  });

  // Verify on-chain evaluator
  const evaluatorMatch = await verifyOnchainEvaluator(jobId);
  if (!evaluatorMatch) {
    console.log(`[EVAL] Job ${jobId}: on-chain evaluator does not match, skipping`);
    checkpoint.updateJob(jobId, {
      phase: 'failed',
      note: 'On-chain evaluator mismatch',
    });
    return;
  }

  // Fetch job detail
  let jobDetail;
  try {
    jobDetail = await client.getJob(jobId);
    if (!jobDetail) throw new Error('Job not found');
  } catch (err) {
    console.error(`[EVAL] Job ${jobId}: failed to fetch detail: ${err.message}`);
    checkpoint.updateJob(jobId, {
      phase: 'failed',
      note: `Failed to fetch job: ${err.message}`,
    });
    return;
  }

  // Mark evaluation started
  checkpoint.updateJob(jobId, {
    phase: 'evaluation_started',
    evaluationStartedAt: new Date().toISOString(),
  });

  console.log(`[EVAL] Job ${jobId}: running LLM evaluation...`);

  // Run LLM evaluation
  let result;
  try {
    // Indexer response: field is "deliverable" (not "deliverableHash")
    // Also check job (wrapper) and direct fields
    const deliverableHash = jobDetail.deliverable || job.deliverable || job.deliverableHash || '';

    // Fetch deliverable content if URI is available
    let deliverableContent = '';
    const deliverableURI = jobDetail.deliverableURI || job.deliverableURI || '';
    if (deliverableURI && deliverableURI.startsWith('http')) {
      try {
        const dRes = await fetch(deliverableURI, { signal: AbortSignal.timeout(10_000) });
        if (dRes.ok) deliverableContent = await dRes.text();
      } catch { /* non-critical */ }
    }

    result = await evaluateJob(
      {
        jobId,
        status: jobDetail.statusLabel || jobDetail.status || 'Submitted',
        provider: jobDetail.provider || job.provider || '',
        description: jobDetail.description || '',
        inputPayload: jobDetail.inputPayload,
        acceptanceCriteria: jobDetail.acceptanceCriteria || jobDetail.inputPayload?.acceptanceCriteria || '',
        requiredCapability: jobDetail.requiredCapability || jobDetail.inputPayload?.requiredCapability || '',
        expectedDeliverable: jobDetail.expectedDeliverable || jobDetail.inputPayload?.expectedDeliverable || '',
        deliverableHash,
        deliverableContent: deliverableContent || jobDetail.deliverableContent || '',
        deliverableURI,
        proofContent: jobDetail.proofContent || '',
        createdAt: jobDetail.createdAt || jobDetail.createdAtBlock || '',
      },
      LLM_CONFIG,
      {
        minConfidence: MIN_CONFIDENCE,
        deliverableHashPresent: Boolean(deliverableHash && deliverableHash !== '0x' && deliverableHash !== '0x0000000000000000000000000000000000000000000000000000000000000000'),
      }
    );
  } catch (err) {
    console.error(`[EVAL] Job ${jobId}: LLM evaluation failed: ${err.message}`);
    checkpoint.updateJob(jobId, {
      phase: 'failed',
      note: `LLM failed: ${err.message}`,
    });
    return;
  }

  // Save evaluation result
  checkpoint.updateJob(jobId, {
    phase: 'evaluation_completed',
    evaluationResult: result,
    decision: result.decision,
    confidence: result.confidence,
  });

  // ── Decision: COMPLETE ─────────────────────────────────────────────────
  if (result.decision === 'complete') {
    if (!AUTO_COMPLETE) {
      console.log(`[EVAL] Job ${jobId}: auto-complete disabled, marking needs_review`);
      checkpoint.updateJob(jobId, {
        phase: 'needs_review',
        note: 'Auto-complete disabled',
      });
      return;
    }

    const reasonHash = '0x' + crypto.createHash('sha256').update(result.reason).digest('hex');

    try {
      console.log(`[EVAL] Job ${jobId}: preparing complete tx...`);
      const txData = await client.prepareCompleteJob(jobId, result.reason);

      // Policy guard is inside signer.signAndSend
      const receipt = await signer.signAndSend(txData);

      checkpoint.updateJob(jobId, {
        phase: 'complete_tx_sent',
        txHash: receipt.txHash,
        txStatus: receipt.status,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      });

      console.log(`[EVAL] Job ${jobId}: COMPLETE tx sent: ${receipt.txHash} (status: ${receipt.status})`);

      // Immediately confirm if receipt shows success
      if (receipt.status === 'success') {
        checkpoint.updateJob(jobId, {
          phase: 'complete_tx_confirmed',
          txStatus: 'success',
          confirmedAt: new Date().toISOString(),
        });
      } else {
        checkpoint.updateJob(jobId, {
          phase: 'failed',
          note: `Complete tx reverted: ${receipt.txHash}`,
        });
      }
    } catch (err) {
      console.error(`[EVAL] Job ${jobId}: complete tx failed: ${err.message}`);
      checkpoint.updateJob(jobId, {
        phase: 'failed',
        note: `Complete tx failed: ${err.message}`,
      });
    }
    return;
  }

  // ── Decision: REJECT ───────────────────────────────────────────────────
  if (result.decision === 'reject') {
    if (!AUTO_REJECT) {
      console.log(`[EVAL] Job ${jobId}: auto-reject disabled, marking needs_review`);
      checkpoint.updateJob(jobId, {
        phase: 'needs_review',
        note: 'Auto-reject disabled',
      });
      return;
    }

    try {
      console.log(`[EVAL] Job ${jobId}: preparing reject tx...`);
      const txData = await client.prepareRejectJob(jobId, result.reason);

      const receipt = await signer.signAndSend(txData);

      checkpoint.updateJob(jobId, {
        phase: 'reject_tx_sent',
        txHash: receipt.txHash,
        txStatus: receipt.status,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      });

      console.log(`[EVAL] Job ${jobId}: REJECT tx sent: ${receipt.txHash} (status: ${receipt.status})`);

      if (receipt.status === 'success') {
        checkpoint.updateJob(jobId, {
          phase: 'reject_tx_confirmed',
          txStatus: 'success',
          confirmedAt: new Date().toISOString(),
        });
      } else {
        checkpoint.updateJob(jobId, {
          phase: 'failed',
          note: `Reject tx reverted: ${receipt.txHash}`,
        });
      }
    } catch (err) {
      console.error(`[EVAL] Job ${jobId}: reject tx failed: ${err.message}`);
      checkpoint.updateJob(jobId, {
        phase: 'failed',
        note: `Reject tx failed: ${err.message}`,
      });
    }
    return;
  }

  // ── Decision: NEEDS_REVIEW ─────────────────────────────────────────────
  console.log(`[EVAL] Job ${jobId}: needs_review (confidence: ${result.confidence.toFixed(2)})`);
  checkpoint.updateJob(jobId, {
    phase: 'needs_review',
    note: `Low confidence or insufficient data`,
  });
}

// ── Main Loop ────────────────────────────────────────────────────────────

async function runOnce() {
  console.log(`[LOOP] Polling for Submitted jobs assigned to ${EVALUATOR_ADDRESS}...`);

  let jobs;
  try {
    const result = await client.listEvaluatorJobs(EVALUATOR_ADDRESS, 'submitted', 50);
    jobs = result.jobs || [];
  } catch (err) {
    console.error(`[LOOP] Failed to list jobs: ${err.message}`);
    return;
  }

  if (jobs.length === 0) {
    console.log('[LOOP] No Submitted jobs found');
    return;
  }

  console.log(`[LOOP] Found ${jobs.length} Submitted job(s)`);

  // Process up to MAX_JOBS_PER_LOOP
  let processed = 0;
  for (const job of jobs) {
    if (processed >= MAX_JOBS_PER_LOOP) {
      console.log(`[LOOP] Reached max jobs per loop (${MAX_JOBS_PER_LOOP}), remaining deferred`);
      break;
    }

    const jobId = String(job.id || job.jobId);

    // Skip if already in terminal state
    if (checkpoint.isTerminal(jobId)) {
      continue;
    }

    // Skip if tx pending
    if (checkpoint.hasPendingOrConfirmedTx(jobId)) {
      continue;
    }

    try {
      await processJob(job);
      processed++;
    } catch (err) {
      console.error(`[LOOP] Error processing job ${jobId}: ${err.message}`);
    }
  }

  console.log(`[LOOP] Processed ${processed} job(s)`);
}

// ── Entry Point ──────────────────────────────────────────────────────────

async function main() {
  // Verify signer at startup
  await signer.verify();

  console.log('[STARTUP] Evaluator bot ready. Starting poll loop...');

  // Initial run
  await runOnce();

  // Poll loop
  while (running) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    if (!running) break;
    try {
      await runOnce();
    } catch (err) {
      console.error(`[LOOP] Unhandled error: ${err.message}`);
    }
  }

  console.log('[SHUTDOWN] Evaluator bot stopped.');
}

main().catch((err) => {
  console.error(`[FATAL] ${err.message}`);
  process.exitCode = 1;
});
