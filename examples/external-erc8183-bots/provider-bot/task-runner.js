/**
 * Task Runner — LLM-backed job execution for ERC-8183 provider bot.
 *
 * Calls LLM with job spec, validates strict JSON output,
 * returns structured resultPayload + proofPayload.
 * No fake fallback — invalid output = no submit.
 */

const crypto = require('crypto');
const { callLLM, callLLMJson } = require('../shared/llm-client');
const { buildMessages } = require('./role-aware-profile');
const { loadProviderSkills } = require('./skill-loader');

const VALID_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);

/** Max raw output length sent to repair prompt (chars). */
const REPAIR_INPUT_MAX_CHARS = 4000;

/**
 * Deterministic JSON repair — no LLM call.
 * Attempts to extract a valid JSON object from malformed output.
 *
 * @param {string} raw - raw LLM output
 * @returns {Object|null} - parsed object or null
 */
function tryDeterministicJsonRepair(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let cleaned = raw.trim();

  // Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
  cleaned = cleaned.replace(/\n?```\s*$/, '');
  cleaned = cleaned.trim();

  // Try direct parse after fence strip
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // Extract substring from first { to last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(candidate); } catch { /* continue */ }
  }

  return null;
}

/**
 * Call LLM with a repair-only prompt to fix malformed JSON.
 * Passes the raw output (truncated) and asks for strict JSON only.
 *
 * @param {Object} env - LLM config
 * @param {string} rawOutput - the malformed raw LLM output
 * @returns {Promise<Object>} - parsed JSON object
 */
async function callLlmJsonRepair(env, rawOutput) {
  const truncated = rawOutput.length > REPAIR_INPUT_MAX_CHARS
    ? rawOutput.slice(0, REPAIR_INPUT_MAX_CHARS) + '\n... [truncated]'
    : rawOutput;

  const repairMessages = [
    {
      role: 'system',
      content: 'You are a JSON repair assistant. You receive a malformed JSON string and return ONLY a valid JSON object. No explanation, no markdown fences, no extra text — only the raw JSON object.',
    },
    {
      role: 'user',
      content: `The following text was supposed to be a valid JSON object but is malformed. Repair it and return ONLY the corrected JSON object. Preserve all original data. If the JSON is irrecoverable, return {"error": "irrecoverable", "confidence": 0, "findings": [], "evidence": {"mode": "llm", "agentType": "${env.agentType}"}}.\n\n---\n${truncated}\n---`,
    },
  ];

  const raw = await callLLM({
    baseUrl: env.baseUrl,
    apiKey: env.apiKey,
    model: env.model,
    messages: repairMessages,
    maxTokens: env.maxTokens || 2500,
    temperature: 0,  // deterministic for repair
    timeoutMs: env.timeoutMs || 60000,
  });

  // Parse repair result with same fence-stripping
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
    cleaned = cleaned.replace(/\n?```\s*$/, '');
    cleaned = cleaned.trim();
  }

  return JSON.parse(cleaned);
}

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
 * @param {number} [env.jsonRepairRetries=1] - LLM JSON repair attempts (0..2)
 * @returns {Promise<{resultPayload: Object, proofPayload: Object}>}
 */
async function runLlmTask(job, env) {
  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const jobType = job.inputPayload?.jobType || 'unknown';
  const requiredCapability = job.inputPayload?.requiredCapability || '';
  const maxRepairRetries = Math.min(Math.max(env.jsonRepairRetries ?? 1, 0), 2);

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

  // Call LLM with repair-on-failure loop
  let llmResult;
  let rawOutput = null;
  let repairUsed = false;
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
  } catch (initialErr) {
    // Initial parse failed — attempt repair
    rawOutput = initialErr.message;

    // Step 1: Deterministic repair (no LLM call)
    const detResult = tryDeterministicJsonRepair(rawOutput);
    if (detResult) {
      console.log(`   [llm] deterministic JSON repair succeeded`);
      llmResult = detResult;
      repairUsed = true;
    } else if (maxRepairRetries > 0) {
      // Step 2: LLM repair call
      for (let attempt = 1; attempt <= maxRepairRetries; attempt++) {
        console.log(`   [llm] invalid JSON, attempting repair ${attempt}/${maxRepairRetries}`);
        try {
          llmResult = await callLlmJsonRepair(env, rawOutput);
          console.log(`   [llm] JSON repair ${attempt} succeeded`);
          repairUsed = true;
          break;
        } catch (repairErr) {
          console.error(`   [llm] JSON repair ${attempt} failed: ${repairErr.message}`);
          if (attempt === maxRepairRetries) {
            // All repair attempts exhausted
            console.error(`   [LLM] All repair attempts exhausted — skipping job`);
            throw initialErr;
          }
        }
      }
    } else {
      // No repair retries allowed
      throw initialErr;
    }
  }

  const durationMs = Date.now() - startTime;

  // Validate output (same validator for original and repaired)
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
    repairUsed,
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

module.exports = { runLlmTask, validateLlmOutput, tryDeterministicJsonRepair };
