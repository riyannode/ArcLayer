/**
 * Task Runner — LLM-backed job execution for ERC-8183 provider bot.
 *
 * Calls LLM with job spec, validates strict JSON output,
 * returns structured resultPayload + proofPayload.
 * No fake fallback — invalid output = no submit.
 */

const crypto = require('crypto');
const { callLLMJson } = require('../shared/llm-client');
const { buildMessages } = require('./role-aware-profile');
const { loadProviderSkills } = require('./skill-loader');

const VALID_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);

/**
 * Run an LLM task for a given job.
 *
 * @param {Object} job - ERC-8183 job from API
 * @param {Object} env - resolved env config
 * @param {string} env.baseUrl - LLM base URL
 * @param {string} env.apiKey - LLM API key (never logged)
 * @param {string} env.model - LLM model name
 * @param {string} env.provider - LLM provider label
 * @param {string} env.agentType - e.g. "smart-contract"
 * @param {string} env.providerAgentId - this provider's agent ID
 * @param {number} [env.maxTokens=2500]
 * @param {number} [env.temperature=0.2]
 * @param {number} [env.timeoutMs=60000]
 * @param {string} [env.providerSkill='auto'] - PROVIDER_SKILL value
 * @param {string} [env.customSkillPath] - PROVIDER_CUSTOM_SKILL_PATH value
 * @returns {Promise<{resultPayload: Object, proofPayload: Object}>}
 */
async function runLlmTask(job, env) {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const jobType = job.inputPayload?.jobType || 'unknown';
  const requiredCapability = job.inputPayload?.requiredCapability || '';

  // Load skill content (cached — no disk I/O on repeat calls)
  const skillContent = loadProviderSkills({
    agentType: env.agentType,
    providerSkill: env.providerSkill || 'auto',
    customSkillPath: env.customSkillPath || '',
  });

  // Build prompt (strips all secrets)
  const messages = buildMessages(job, {
    model: env.model,
    providerAgentId: env.providerAgentId,
    agentType: env.agentType,
    capabilities: env.capabilities,
    skillContent,
  });

  // Call LLM
  let llmResult;
  try {
    llmResult = await callLLMJson({
      baseUrl: env.baseUrl,
      apiKey: env.apiKey,
      model: env.model,
      messages,
      maxTokens: env.maxTokens || 2500,
      temperature: env.temperature ?? 0.2,
      timeoutMs: env.timeoutMs || 60000,
    });
  } catch (err) {
    // LLM failure — log safe error, throw to leave job retryable
    console.error(`   [LLM] Call failed: ${err.message}`);
    throw err;
  }

  const durationMs = Date.now() - startTime;

  // Validate output
  const validation = validateLlmOutput(llmResult, env.agentType);
  if (!validation.valid) {
    console.error(`   [LLM] Validation failed: ${validation.errors.join('; ')}`);
    throw new Error(`LLM output invalid: ${validation.errors.join('; ')}`);
  }

  // Build jobSpecHash from job content (deterministic, no secrets)
  const specString = JSON.stringify({
    localJobId: job.localJobId || job.id,
    erc8183JobId: job.erc8183JobId,
    jobType,
    requiredCapability,
  });
  const jobSpecHash = '0x' + crypto.createHash('sha256').update(specString).digest('hex');

  // Inject actual metadata into evidence
  if (llmResult.evidence) {
    llmResult.evidence.model = env.model;
    llmResult.evidence.provider = env.provider;
    llmResult.evidence.generatedAt = new Date().toISOString();
  }

  const resultPayload = {
    providerAgentId: env.providerAgentId,
    mode: 'llm',
    agentType: env.agentType,
    jobType,
    requiredCapability,
    deliverable: llmResult,
    confidence: llmResult.confidence,
    processedAt: new Date().toISOString(),
    runId,
  };

  const proofPayload = {
    runtime: 'pm2',
    mode: 'llm',
    agentType: env.agentType,
    provider: env.provider,
    model: env.model,
    durationMs,
    providerAgentId: env.providerAgentId,
    jobSpecHash,
  };

  return { resultPayload, proofPayload };
}

/**
 * Validate LLM output against required JSON shape.
 * Returns { valid: boolean, errors: string[] }
 */
function validateLlmOutput(output, expectedAgentType) {
  const errors = [];

  if (!output || typeof output !== 'object') {
    return { valid: false, errors: ['output is not an object'] };
  }

  // summary or answer must be non-empty
  const hasSummary = typeof output.summary === 'string' && output.summary.trim().length > 0;
  const hasAnswer = typeof output.answer === 'string' && output.answer.trim().length > 0;
  if (!hasSummary && !hasAnswer) {
    errors.push('summary and answer are both empty or missing');
  }

  // confidence must be number 0..1
  if (typeof output.confidence !== 'number' || output.confidence < 0 || output.confidence > 1) {
    errors.push(`confidence must be number 0..1, got: ${typeof output.confidence} ${output.confidence}`);
  }

  // findings must be array
  if (!Array.isArray(output.findings)) {
    errors.push('findings must be an array');
  } else {
    // Each finding severity must be valid
    for (let i = 0; i < output.findings.length; i++) {
      const f = output.findings[i];
      if (!VALID_SEVERITIES.has(f.severity)) {
        errors.push(`findings[${i}].severity invalid: "${f.severity}" (must be info|low|medium|high|critical)`);
      }
    }
  }

  // evidence.mode must be "llm"
  if (output.evidence?.mode !== 'llm') {
    errors.push(`evidence.mode must be "llm", got: "${output.evidence?.mode}"`);
  }

  // evidence.agentType must match configured provider agent type
  const expectedType = expectedAgentType || 'other';
  if (output.evidence?.agentType !== expectedType) {
    errors.push(`evidence.agentType must be "${expectedType}", got: "${output.evidence?.agentType}"`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { runLlmTask, validateLlmOutput };
