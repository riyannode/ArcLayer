/**
 * LLM Task Helper — LLM-backed job execution for provider-runtime-bot.
 *
 * Self-contained: all LLM execution modules are bundled in ./shared/.
 * No external dependencies on legacy external-erc8183-bots.
 *
 * Bundled modules:
 *   - shared/task-runner.js (runLlmTask)
 *   - shared/llm-client.js (callLLM)
 *   - shared/role-aware-profile.js (buildMessages)
 *   - shared/skill-loader.js (loadProviderSkills)
 *
 * Computes deliverableHash from full deliverablePayload (deep canonical stringify).
 * Never logs API keys or raw LLM content.
 */

const crypto = require('crypto');
const path = require('path');

// ── Resolve paths to bundled modules ───────────────────────────────────────
const SHARED_DIR = path.join(__dirname, 'shared');

// Lazy-loaded module (loaded once on first use)
let _runLlmTask = null;

function loadModules() {
  if (_runLlmTask) return;

  try {
    // runLlmTask() internally loads loadProviderSkills + buildMessages — no need to load here
    _runLlmTask = require(path.join(SHARED_DIR, 'task-runner.js')).runLlmTask;
  } catch (err) {
    throw new Error(
      `Failed to load LLM task modules from ${SHARED_DIR}. ` +
      `Ensure shared/ directory exists with task-runner.js. Error: ${err.message}`
    );
  }
}

// ── Deep Canonical Stringify ────────────────────────────────────────────────
// Recursively sorts all object keys at every nesting level.
// Produces deterministic JSON regardless of key insertion order.
// Handles: objects, arrays, primitives, null, nested structures.

function stableStringify(value) {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    const items = value.map((v) => stableStringify(v));
    return `[${items.join(',')}]`;
  }

  // Object — sort keys recursively
  const keys = Object.keys(value).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${pairs.join(',')}}`;
}

// ── LLM Config Validation ───────────────────────────────────────────────────

/**
 * Validate LLM env config at startup. Throws if required vars missing.
 * Fails fast — no placeholder fallback.
 *
 * @param {Object} env - process.env
 * @returns {Object} resolved LLM config
 */
function validateLlmConfig(env) {
  const provider = env.LLM_PROVIDER || '';
  const baseUrl = env.LLM_BASE_URL || '';
  const apiKey = env.LLM_API_KEY || '';
  const model = env.LLM_MODEL || '';
  const maxTokens = parseInt(env.LLM_MAX_TOKENS || '2500', 10);
  const temperature = parseFloat(env.LLM_TEMPERATURE || '0.2');
  const timeoutMs = parseInt(env.LLM_TIMEOUT_MS || '60000', 10);
  const jsonRepairRetries = parseInt(env.LLM_JSON_REPAIR_RETRIES || '1', 10);

  const errors = [];
  if (!provider) errors.push('LLM_PROVIDER');
  if (!baseUrl) errors.push('LLM_BASE_URL');
  if (!model) errors.push('LLM_MODEL');

  // LLM_API_KEY required unless provider is local/no-auth
  const isLocalAuth = provider === 'local' || provider === 'no-auth';
  if (!apiKey && !isLocalAuth) errors.push('LLM_API_KEY');

  if (errors.length > 0) {
    throw new Error(
      `LLM config incomplete: ${errors.join(', ')}. ` +
      `Set these in .env. Required for deliverable generation.`
    );
  }

  return { provider, baseUrl, apiKey, model, maxTokens, temperature, timeoutMs, jsonRepairRetries };
}

// ── LLM Task Execution ──────────────────────────────────────────────────────

/**
 * Run LLM task for a job and return { resultPayload, proofPayload, deliverableHash }.
 *
 * The deliverableHash is computed from the FULL deliverablePayload (not just resultPayload).
 * Uses deep canonical stringify to ensure deterministic hashing regardless of key order.
 *
 * @param {Object} job - full job object (from MCP jobs.get_public or indexer)
 * @param {Object} llmConfig - validated LLM config from validateLlmConfig()
 * @param {Object} botConfig - { agentId, agentType, capabilities, providerSkill, customSkillPath }
 * @returns {Promise<{ resultPayload: Object, proofPayload: Object, deliverableHash: string, deliverablePayload: Object }>}
 */
async function runLlmTaskForJob(job, llmConfig, botConfig) {
  loadModules();

  // Build env object expected by task-runner.js
  const llmEnv = {
    baseUrl: llmConfig.baseUrl,
    apiKey: llmConfig.apiKey,
    model: llmConfig.model,
    provider: llmConfig.provider,
    agentType: botConfig.agentType || 'other',
    providerAgentId: botConfig.agentId,
    capabilities: botConfig.capabilities || [],
    maxTokens: llmConfig.maxTokens,
    temperature: llmConfig.temperature,
    timeoutMs: llmConfig.timeoutMs,
    providerSkill: botConfig.providerSkill || 'auto',
    customSkillPath: botConfig.customSkillPath || '',
    jsonRepairRetries: llmConfig.jsonRepairRetries,
  };

  // runLlmTask() loads skills internally via loadProviderSkills() — no need to call here.
  // Run existing task-runner (handles LLM call, JSON parse, repair, validation, skill loading)
  const { resultPayload, proofPayload } = await _runLlmTask(job, llmEnv);

  // Build full deliverablePayload (the actual onchain deliverable)
  const deliverablePayload = {
    schema: 'arclayer.provider.deliverable.v1',
    jobId: job.id || job.localJobId || '',
    erc8183JobId: job.erc8183JobId || '',
    providerAgentId: botConfig.agentId,
    runtime: 'llm',
    resultPayload,
    proofPayload,
    createdAt: new Date().toISOString(),
  };

  // Deep canonical stringify — deterministic regardless of key insertion order
  const deliverableString = stableStringify(deliverablePayload);
  const deliverableHash = '0x' + crypto.createHash('sha256').update(deliverableString).digest('hex');

  return { resultPayload, proofPayload, deliverableHash, deliverablePayload };
}

module.exports = { validateLlmConfig, runLlmTaskForJob, stableStringify };
