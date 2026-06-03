/**
 * Evaluator bot — reviews deliverables using LLM or rules, approves/soft-rejects.
 *
 * Loop:
 *   1. Poll for submitted jobs (evaluatorAgentId matches)
 *   2. Read job spec, result payload, proof payload
 *   3. Run evaluator strategy (LLM preferred, rules fallback)
 *   4. If approved + score >= MIN_EVAL_SCORE: call complete, sign + broadcast complete tx
 *   5. If rejected or score < MIN_EVAL_SCORE: soft-reject (log evidence, no complete call)
 *
 * Note: Protocol-level slash/dispute is NOT implemented in current ERC-8183 MVP.
 * Soft-rejection means the evaluator does NOT call complete — escrow stays open.
 * Slash is logged as a future extension only.
 */
require('dotenv').config({ path: __dirname + '/.env' });

const api = require('../shared/erc8183-http-client');
api.setRole('evaluator');
const { createSigner } = require('../shared/tx-signer');
const { required, requiredAddress, normalizePrivateKey, optional, int, bool } = require('../shared/config');
const { sleep } = require('../shared/sleep');

// ── Env ─────────────────────────────────────────────────────────────────
const BASE_URL = required('ARCLAYER_BASE_URL');
const EVALUATOR_AGENT_ID = required('EVALUATOR_AGENT_ID');
const EVALUATOR_ADDRESS = requiredAddress('EVALUATOR_ADDRESS');
const EVALUATOR_PK = normalizePrivateKey(required('EVALUATOR_PRIVATE_KEY'));
const ARC_RPC_URL = required('ARC_RPC_URL');
const POLL_INTERVAL_MS = int('JOB_POLL_INTERVAL_MS', 60000);
const AUTONOMOUS_TX = bool('AUTONOMOUS_TX', true);
const EVALUATOR_MODE = optional('EVALUATOR_MODE', 'rules');
const MAX_ACTIVE_JOBS = int('MAX_ACTIVE_JOBS', 3);
const MIN_EVAL_SCORE = int('MIN_EVAL_SCORE', 70);
const IGNORE_JOBS_BEFORE = optional('IGNORE_JOBS_BEFORE', '');
const RECOVER_OLD_JOBS = bool('RECOVER_OLD_JOBS', false);

// LLM config
const LLM_BASE_URL = optional('LLM_BASE_URL', '');
const LLM_MODEL = optional('LLM_MODEL', 'xiaomi/mimo-v2-flash');
const LLM_API_KEY = optional('LLM_API_KEY', '');

// ── Structured logger ───────────────────────────────────────────────────
function log(phase, data = {}) {
  const ts = new Date().toISOString();
  const parts = Object.entries(data).map(([k, v]) => `${k}=${v}`);
  console.log(`[${ts}] [EVALUATOR] phase=${phase} ${parts.join(' ')}`);
}

function logError(phase, data = {}) {
  const ts = new Date().toISOString();
  const parts = Object.entries(data).map(([k, v]) => `${k}=${v}`);
  console.error(`[${ts}] [EVALUATOR] phase=${phase} ${parts.join(' ')}`);
}

// ── Signer ──────────────────────────────────────────────────────────────
const signer = createSigner({ privateKey: EVALUATOR_PK, rpcUrl: ARC_RPC_URL });

// Track processed jobs
const processedJobs = new Set();

// ── Stale job filter ────────────────────────────────────────────────────
function shouldIgnoreJob(job) {
  if (RECOVER_OLD_JOBS) return false;
  if (!IGNORE_JOBS_BEFORE) return false;

  const jobTime = job.createdAt || job.created_at;
  if (!jobTime) return false;

  const jobTs = new Date(jobTime).getTime();
  const cutoffTs = new Date(IGNORE_JOBS_BEFORE).getTime();
  return jobTs < cutoffTs;
}

// ── Extract payloads (handles both flat and nested payloads structure) ──
function extractPayloads(job) {
  // Detail API nests under payloads{}, list API returns flat
  const rp = job.resultPayload || job.payloads?.resultPayload || job.deliverable || {};
  const pp = job.proofPayload || job.payloads?.proofPayload || job.proof || {};
  const ip = job.inputPayload || job.payloads?.inputPayload || {};
  return { resultPayload: rp, proofPayload: pp, inputPayload: ip };
}

// ── LLM evaluation ─────────────────────────────────────────────────────

async function callLlm(systemPrompt, userPrompt) {
  if (!LLM_BASE_URL || !LLM_API_KEY) {
    throw new Error('LLM_BASE_URL and LLM_API_KEY required for LLM mode');
  }

  const url = `${LLM_BASE_URL}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  // LLM may wrap JSON in markdown code fences
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

const LLM_SYSTEM_PROMPT = `You are an ERC-8183 job evaluator for an autonomous agentic commerce protocol.
You will receive a job specification, provider result payload, and proof payload.
Your task: evaluate whether the provider's output is high quality and meets the job requirements.

You MUST return strict JSON with these exact fields:
{
  "approved": boolean,
  "score": number (0-100),
  "reason": string (max 200 chars),
  "qualityFlags": string[] (list of quality observations),
  "slashRecommended": boolean
}

Guidelines:
- Score >= 70 is acceptable. Below 70 is a soft reject.
- approved should be true only if score >= 70 AND the result meaningfully addresses the query.
- slashRecommended is always false for MVP (no slash path exists).
- Be strict but fair. Low-effort or generic responses score below 50.
- Structured output with evidence scores above 60.`;

async function evaluateByLlm(job, resultPayload, proofPayload) {
  const jobSpec = {
    description: job.description,
    inputPayload: job.inputPayload || job.payloads?.inputPayload,
    budgetAtomic: job.budgetAtomic || job.budget?.atomic,
  };

  const userPrompt = `JOB SPECIFICATION:
${JSON.stringify(jobSpec, null, 2)}

WORKER RESULT:
${JSON.stringify(resultPayload, null, 2)}

PROOF:
${JSON.stringify(proofPayload, null, 2)}

Evaluate this work. Return JSON only.`;

  const result = await callLlm(LLM_SYSTEM_PROMPT, userPrompt);

  // Validate structure — strict boolean check to prevent Boolean("false") === true
  if (typeof result.approved !== 'boolean') {
    throw new Error('LLM evaluation approved must be a boolean');
  }

  const approved = result.approved === true;
  const score = Math.min(100, Math.max(0, parseInt(result.score, 10) || 0));
  const reason = String(result.reason || 'no reason provided').slice(0, 200);
  const qualityFlags = Array.isArray(result.qualityFlags) ? result.qualityFlags : [];
  const slashRecommended = false; // Force false — no slash path in MVP

  return {
    approved: approved && score >= MIN_EVAL_SCORE,
    score,
    reason,
    qualityFlags,
    slashRecommended,
    mode: 'llm',
    model: LLM_MODEL,
  };
}

// ── Rules-based evaluation (fallback) ──────────────────────────────────

function evaluateByRules(job, resultPayload, proofPayload) {
  const providerId = resultPayload?.providerAgentId || resultPayload?.workerId || job.workerId || job.participants?.provider?.agentId || job.participants?.worker?.agentId;
  const checks = {
    hasResult: Boolean(resultPayload && Object.keys(resultPayload).length > 0),
    hasProof: Boolean(proofPayload && Object.keys(proofPayload).length > 0),
    hasProviderId: Boolean(providerId),
    hasConfidence: typeof resultPayload?.confidence === 'number' && resultPayload.confidence > 0,
    hasJobType: Boolean(resultPayload?.jobType),
    hasRunId: Boolean(resultPayload?.runId),
    hasOnChainTx: Boolean(job.submitTxHash || job.deliverableHash || job.txHashes?.submitTxHash),
    deliverableSubmitted: Boolean(job.deliverableHash || job.erc8183Status === 'Submitted' || job.lifecycleStatus === 'Submitted'),
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const score = Math.round((passed / total) * 100);
  const allPassed = passed === total;
  const qualityFlags = [];

  if (!checks.hasConfidence) qualityFlags.push('missing_confidence');
  if (!checks.hasJobType) qualityFlags.push('missing_job_type');
  if (!checks.hasRunId) qualityFlags.push('missing_run_id');

  return {
    approved: allPassed,
    score,
    checks,
    reason: allPassed ? 'deliverable-approved' : `deliverable-rejected: ${total - passed} check(s) failed`,
    qualityFlags,
    slashRecommended: false, // No slash path in MVP
    mode: 'rules',
  };
}

// ── Poll + process ──────────────────────────────────────────────────────

async function pollAndProcess() {
  try {
    let jobs;
    try {
      const result = await api.listJobs({ status: 'submitted', limit: '50' });
      jobs = Array.isArray(result) ? result : result?.jobs || result?.data || [];
    } catch {
      jobs = [];
    }

    if (!Array.isArray(jobs)) jobs = [];

    const submittedJobs = jobs.filter((job) => {
      const localJobId = job.localJobId || job.id;
      const evaluatorMatch = job.evaluatorAgentId === EVALUATOR_AGENT_ID;
      const statusMatch = job.erc8183Status === 'Submitted';
      const notProcessed = !processedJobs.has(localJobId);

      if (!evaluatorMatch || !statusMatch || !notProcessed) return false;

      if (shouldIgnoreJob(job)) {
        log('skip_stale_job', { localJobId, createdAt: job.createdAt || 'unknown' });
        processedJobs.add(localJobId);
        return false;
      }

      return true;
    });

    if (submittedJobs.length === 0) return;

    let processed = 0;
    for (const job of submittedJobs) {
      if (processed >= MAX_ACTIVE_JOBS) {
        log('max_active_jobs_hit', { max: MAX_ACTIVE_JOBS });
        break;
      }
      const localJobId = job.localJobId || job.id;
      log('submitted_job_found', { localJobId, evaluatorId: job.evaluatorAgentId });
      await evaluateAndComplete(localJobId);
      processed++;
    }
  } catch (err) {
    logError('poll_error', { error: err.message });
  }
}

async function evaluateAndComplete(localJobId) {
  try {
    // 1. Get full job details
    const resp = await api.getJob(localJobId);
    const job = resp.job || resp;

    // Extract payloads (handles flat and nested structure)
    const { resultPayload, proofPayload, inputPayload } = extractPayloads(job);
    const jobType = inputPayload?.jobType || 'unknown';

    log('job_detail_loaded', {
      localJobId,
      jobType,
      resultPayloadKeys: Object.keys(resultPayload).length,
      proofPayloadKeys: Object.keys(proofPayload).length,
    });

    // 2. Run evaluation strategy
    let evaluation;
    const useLlm = EVALUATOR_MODE === 'llm' && LLM_BASE_URL && LLM_API_KEY;

    if (useLlm) {
      log('evaluating_llm', { model: LLM_MODEL });
      try {
        evaluation = await evaluateByLlm(job, resultPayload, proofPayload);
      } catch (llmErr) {
        logError('llm_fallback', { error: llmErr.message });
        evaluation = evaluateByRules(job, resultPayload, proofPayload);
      }
    } else {
      evaluation = evaluateByRules(job, resultPayload, proofPayload);
    }

    log('evaluation_result', {
      mode: evaluation.mode,
      approved: evaluation.approved,
      score: evaluation.score,
      minScore: MIN_EVAL_SCORE,
      reason: evaluation.reason,
    });

    if (evaluation.qualityFlags?.length > 0) {
      log('quality_flags', { flags: evaluation.qualityFlags.join(',') });
    }

    // 3. Decision: approve or soft-reject
    if (evaluation.approved && evaluation.score >= MIN_EVAL_SCORE) {
      // APPROVED — complete escrow
      log('complete_start', { localJobId });

      const completed = await api.complete(localJobId, {
        evaluatorAgentId: EVALUATOR_AGENT_ID,
        approved: true,
        reason: evaluation.reason,
      });

      if (AUTONOMOUS_TX) {
        log('complete_tx_signing', { localJobId });
        const completeResult = await signer.sendTx(completed.tx);
        log('complete_tx', { localJobId, tx: completeResult.hash });
        await sleep(3000);

        const confirmed = await api.confirmTx(localJobId, 'complete', completeResult.hash);
        log('complete_confirmed', {
          localJobId,
          status: confirmed.erc8183Status || confirmed.lifecycleStatus || 'unknown',
          completeTxHash: completeResult.hash,
        });

        // Check provider reputation after completion
        log('reputation_check_started', { localJobId });
        await sleep(5000);
        try {
          const providerId = job.participants?.provider?.agentId || job.providerAgentId;
          const repId = providerId || job.workerId;
          if (repId) {
            const repResp = await fetch(`${BASE_URL}/api/a2a/reputation/${repId}`);
            if (repResp.ok) {
              const repData = await repResp.json();
              log('reputation_updated', {
                agentId: repId,
                score: repData.score ?? repData.reputation?.score ?? 'unknown',
                feedbackCount: repData.feedbackCount ?? repData.reputation?.feedbackCount ?? 'unknown',
                callsServed: repData.callsServed ?? repData.reputation?.callsServed ?? 'unknown',
              });
            } else {
              log('reputation_pending', { agentId: repId, httpStatus: repResp.status });
            }
          }
        } catch (repErr) {
          log('reputation_check_error', { error: repErr.message });
        }
      } else {
        log('complete_manual_mode', { localJobId });
      }

      log('job_completed', { localJobId });
    } else {
      // SOFT REJECT — do NOT call complete
      log('soft_reject', {
        localJobId,
        score: evaluation.score,
        reason: evaluation.reason,
      });
    }

    processedJobs.add(localJobId);

  } catch (err) {
    logError('evaluation_failed', { localJobId, error: err.message });
    if (err.body) logError('evaluation_failed_body', { body: JSON.stringify(err.body).slice(0, 200) });
    processedJobs.add(localJobId);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  log('startup', {
    url: BASE_URL,
    evaluatorId: EVALUATOR_AGENT_ID,
    address: EVALUATOR_ADDRESS,
    mode: EVALUATOR_MODE,
    minScore: MIN_EVAL_SCORE,
    autonomous: AUTONOMOUS_TX,
    pollInterval: POLL_INTERVAL_MS,
    ignoreBefore: IGNORE_JOBS_BEFORE || 'none',
    recoverOld: RECOVER_OLD_JOBS,
  });

  if (EVALUATOR_MODE === 'llm') {
    if (LLM_BASE_URL && LLM_API_KEY) {
      log('llm_config', { model: LLM_MODEL, baseUrl: LLM_BASE_URL });
    } else {
      logError('llm_missing_config', {});
    }
  }

  await pollAndProcess();
  setInterval(pollAndProcess, POLL_INTERVAL_MS);
}

main().catch((err) => {
  logError('fatal', { error: err.message });
  process.exit(1);
});
