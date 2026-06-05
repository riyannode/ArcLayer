/**
 * LLM Task Helper — bridges existing task-runner.js into provider-runtime-bot.
 *
 * Reuses:
 *   - examples/external-erc8183-bots/provider-bot/task-runner.js (runLlmTask)
 *   - examples/external-erc8183-bots/shared/llm-client.js (callLLM)
 *   - examples/external-erc8183-bots/provider-bot/role-aware-profile.js (buildMessages)
 *   - examples/external-erc8183-bots/provider-bot/skill-loader.js (loadProviderSkills)
 *
 * No code duplication. Loads via require() from the existing path.
 * Computes deliverableHash from actual LLM output (SHA-256 of JSON).
 * Never logs API keys or raw LLM content.
 */

const crypto = require('crypto');
const path = require('path');

// ── Resolve paths to existing modules ───────────────────────────────────────
// These are relative to this file's directory.
const EXTERNAL_BOTS_DIR = path.resolve(__dirname, '../../external-erc8183-bots');
const PROVIDER_BOT_DIR = path.join(EXTERNAL_BOTS_DIR, 'provider-bot');
const SHARED_DIR = path.join(EXTERNAL_BOTS_DIR, 'shared');

// Lazy-loaded modules (loaded once on first use)
let _runLlmTask = null;
let _loadProviderSkills = null;
let _buildMessages = null;

function loadModules() {
  if (_runLlmTask) return; // already loaded

  try {
    _runLlmTask = require(path.join(PROVIDER_BOT_DIR, 'task-runner.js')).runLlmTask;
    _loadProviderSkills = require(path.join(PROVIDER_BOT_DIR, 'skill-loader.js')).loadProviderSkills;
    _buildMessages = require(path.join(PROVIDER_BOT_DIR, 'role-aware-profile.js')).buildMessages;
  } catch (err) {
    throw new Error(
      `Failed to load LLM task modules from ${EXTERNAL_BOTS_DIR}. ` +
      `Ensure examples/external-erc8183-bots exists. Error: ${err.message}`
    );
  }
}

/**
 * Validate LLM env config at startup. Throws if required vars missing.
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
      `Set these in .env. Required for real deliverable generation.`
    );
  }

  return { provider, baseUrl, apiKey, model, maxTokens, temperature, timeoutMs, jsonRepairRetries };
}

/**
 * Run LLM task for a job and return { resultPayload, proofPayload, deliverableHash }.
 *
 * @param {Object} job - full job object (from MCP jobs.get_public or indexer)
 * @param {Object} llmConfig - validated LLM config from validateLlmConfig()
 * @param {Object} botConfig - { agentId, agentType, capabilities, providerSkill, customSkillPath }
 * @returns {Promise<{ resultPayload: Object, proofPayload: Object, deliverableHash: string }>}
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

  // Load skills (cached after first call)
  const skillContent = _loadProviderSkills({
    agentType: llmEnv.agentType,
    providerSkill: llmEnv.providerSkill,
    customSkillPath: llmEnv.customSkillPath,
  });

  // Run existing task-runner (handles LLM call, JSON parse, repair, validation)
  const { resultPayload, proofPayload } = await _runLlmTask(job, llmEnv);

  // Compute deliverableHash from actual result (SHA-256 of deterministic JSON)
  const deliverableString = JSON.stringify(resultPayload, Object.keys(resultPayload).sort());
  const deliverableHash = '0x' + crypto.createHash('sha256').update(deliverableString).digest('hex');

  return { resultPayload, proofPayload, deliverableHash };
}

module.exports = { validateLlmConfig, runLlmTaskForJob };
