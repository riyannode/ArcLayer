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
const { createSigner } = require('../shared/tx-signer');
const { required, requiredAddress, normalizePrivateKey } = require('../shared/env');
const { sleep } = require('../shared/sleep');

// ── Env ─────────────────────────────────────────────────────────────────
const BASE_URL = required('ARCLAYER_BASE_URL');
const EVALUATOR_AGENT_ID = required('EVALUATOR_AGENT_ID');
const EVALUATOR_ADDRESS = requiredAddress('EVALUATOR_ADDRESS');
const EVALUATOR_PK = normalizePrivateKey(required('EVALUATOR_PRIVATE_KEY'));
const ARC_RPC_URL = required('ARC_RPC_URL');
const POLL_INTERVAL_MS = parseInt(process.env.JOB_POLL_INTERVAL_MS || '60000', 10);
const AUTONOMOUS_TX = process.env.AUTONOMOUS_TX === 'true';
const EVALUATOR_MODE = process.env.EVALUATOR_MODE || 'rules';
const MAX_ACTIVE_JOBS = parseInt(process.env.MAX_ACTIVE_JOBS || '3', 10);
const MIN_EVAL_SCORE = parseInt(process.env.MIN_EVAL_SCORE || '70', 10);

// LLM config
const LLM_BASE_URL = process.env.LLM_BASE_URL || '';
const LLM_MODEL = process.env.LLM_MODEL || 'xiaomi/mimo-v2-flash';
const LLM_API_KEY = process.env.LLM_API_KEY || '';

// ── Signer ──────────────────────────────────────────────────────────────
const signer = createSigner({ privateKey: EVALUATOR_PK, rpcUrl: ARC_RPC_URL });
console.log(`Evaluator signer address: ${signer.address}`);

// Track processed jobs
const processedJobs = new Set();

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
You will receive a job specification, worker result payload, and proof payload.
Your task: evaluate whether the worker's output is high quality and meets the job requirements.

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
    inputPayload: job.inputPayload,
    budgetAtomic: job.budgetAtomic,
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
  const workerId = resultPayload?.workerId || job.workerId;
  const checks = {
    hasResult: Boolean(resultPayload && Object.keys(resultPayload).length > 0),
    hasProof: Boolean(proofPayload && Object.keys(proofPayload).length > 0),
    hasWorkerId: Boolean(workerId),
    hasConfidence: typeof resultPayload?.confidence === 'number' && resultPayload.confidence > 0,
    hasJobType: Boolean(resultPayload?.jobType),
    hasRunId: Boolean(resultPayload?.runId),
    hasOnChainTx: Boolean(job.submitTxHash || job.deliverableHash),
    deliverableSubmitted: Boolean(job.deliverableHash || job.erc8183Status === 'Submitted'),
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
      return (
        job.evaluatorAgentId === EVALUATOR_AGENT_ID &&
        job.erc8183Status === 'Submitted' &&
        !processedJobs.has(job.localJobId || job.id)
      );
    });

    if (submittedJobs.length === 0) return;

    let processed = 0;
    for (const job of submittedJobs) {
      if (processed >= MAX_ACTIVE_JOBS) {
        console.log(`   Hit MAX_ACTIVE_JOBS (${MAX_ACTIVE_JOBS}) — more jobs queued for next cycle`);
        break;
      }
      const localJobId = job.localJobId || job.id;
      console.log(`\n[${new Date().toISOString()}] Found submitted job: ${localJobId}`);
      await evaluateAndComplete(localJobId);
      processed++;
    }
  } catch (err) {
    console.error(`   Poll error:`, err.message);
  }
}

async function evaluateAndComplete(localJobId) {
  try {
    // 1. Get full job details
    const resp = await api.getJob(localJobId);
    const job = resp.job || resp;
    const jobType = job.inputPayload?.jobType || 'unknown';
    console.log(`   Job spec: ${job.description || 'n/a'} (type: ${jobType})`);

    // 2. Extract result/proof
    const resultPayload = job.resultPayload || job.deliverable || {};
    const proofPayload = job.proofPayload || job.proof || {};

    console.log(`   Result: ${JSON.stringify(resultPayload).slice(0, 200)}`);
    console.log(`   Proof: ${JSON.stringify(proofPayload).slice(0, 200)}`);

    // 3. Run evaluation strategy
    let evaluation;
    const useLlm = EVALUATOR_MODE === 'llm' && LLM_BASE_URL && LLM_API_KEY;

    if (useLlm) {
      console.log(`   Evaluating via LLM (${LLM_MODEL})...`);
      try {
        evaluation = await evaluateByLlm(job, resultPayload, proofPayload);
      } catch (llmErr) {
        console.warn(`   ⚠ LLM evaluation failed: ${llmErr.message} — falling back to rules`);
        evaluation = evaluateByRules(job, resultPayload, proofPayload);
      }
    } else {
      if (EVALUATOR_MODE === 'llm') {
        console.warn(`   ⚠ EVALUATOR_MODE=llm but LLM_BASE_URL or LLM_API_KEY missing — using rules`);
      }
      evaluation = evaluateByRules(job, resultPayload, proofPayload);
    }

    console.log(`   Evaluation (${evaluation.mode}): approved=${evaluation.approved}, score=${evaluation.score}/${MIN_EVAL_SCORE}`);
    console.log(`   Reason: ${evaluation.reason}`);
    if (evaluation.qualityFlags?.length > 0) {
      console.log(`   Quality flags: ${evaluation.qualityFlags.join(', ')}`);
    }

    // 4. Decision: approve or soft-reject
    if (evaluation.approved && evaluation.score >= MIN_EVAL_SCORE) {
      // APPROVED — complete escrow
      console.log(`   ✅ Approved — completing escrow...`);
      const completed = await api.complete(localJobId, {
        evaluatorAgentId: EVALUATOR_AGENT_ID,
        approved: true,
        reason: evaluation.reason,
      });

      if (AUTONOMOUS_TX) {
        console.log(`   Signing complete tx...`);
        const completeResult = await signer.sendTx(completed.tx);
        console.log(`   complete tx: ${completeResult.hash}`);
        await sleep(2000);

        const confirmed = await api.confirmTx(localJobId, 'complete', completeResult.hash);
        console.log(`   Complete confirmed! status: ${confirmed.erc8183Status}`);
      } else {
        console.log(`   [MANUAL TX] complete instruction:`);
        console.log(`     ${JSON.stringify(completed.tx)}`);
      }

      console.log(`   ✅ Job ${localJobId} completed`);
    } else {
      // SOFT REJECT — do NOT call complete
      // Current ERC-8183 MVP does not support reject/slash/dispute path.
      // Evaluator simply does not call complete. Escrow stays open.
      console.warn(`   ❌ [evaluator] soft_reject job=${localJobId} score=${evaluation.score} reason="${evaluation.reason}"`);
      if (evaluation.qualityFlags?.length > 0) {
        console.warn(`   qualityFlags: [${evaluation.qualityFlags.join(', ')}]`);
      }
      console.warn(`   Note: Protocol-level slash/dispute not implemented in current ERC-8183 MVP.`);
      console.warn(`   Job ${localJobId} — escrow remains open (no complete call made).`);
    }

    processedJobs.add(localJobId);

  } catch (err) {
    console.error(`   ❌ Job ${localJobId} evaluation failed:`, err.message);
    if (err.body) console.error('   body:', JSON.stringify(err.body));
    processedJobs.add(localJobId);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== ERC-8183 Evaluator Bot (autonomous job market) ===');
  console.log(`URL: ${BASE_URL}`);
  console.log(`Evaluator: ${EVALUATOR_AGENT_ID}`);
  console.log(`Address: ${EVALUATOR_ADDRESS}`);
  console.log(`Mode: ${EVALUATOR_MODE}`);
  console.log(`Min score: ${MIN_EVAL_SCORE}`);
  console.log(`Autonomous: ${AUTONOMOUS_TX}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);

  if (EVALUATOR_MODE === 'llm') {
    if (LLM_BASE_URL && LLM_API_KEY) {
      console.log(`LLM: ${LLM_MODEL} @ ${LLM_BASE_URL}`);
    } else {
      console.warn(`⚠ EVALUATOR_MODE=llm but LLM_BASE_URL or LLM_API_KEY missing — will fallback to rules`);
    }
  }

  await pollAndProcess();
  setInterval(pollAndProcess, POLL_INTERVAL_MS);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
