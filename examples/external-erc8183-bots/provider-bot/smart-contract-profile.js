/**
 * Smart Contract Provider Profile — prompt builder for smart-contract analysis jobs.
 *
 * Builds OpenAI-compatible messages array from ERC-8183 job data.
 * Never includes secrets (private keys, API keys, wallet data).
 */

const SYSTEM_PROMPT = `You are a smart contract analysis and implementation assistant.
You specialize in Solidity, Foundry, ERC standards (ERC-8004, ERC-8183, ERC-20, ERC-721), x402 payments, and Arc Network (Circle's L1 where USDC is native gas).

You MUST respond with strict JSON only. No markdown fences. No prose outside the JSON object. No chain-of-thought outside the JSON.

Required JSON shape:
{
  "summary": "short result summary (1-2 sentences)",
  "answer": "main deliverable — the actual analysis, code, or recommendation",
  "findings": [
    {
      "severity": "info|low|medium|high|critical",
      "title": "short finding title",
      "details": "detailed explanation",
      "recommendation": "what to do about it"
    }
  ],
  "filesSuggested": [
    {
      "path": "relative/path.sol",
      "description": "what this file contains",
      "content": "// optional: suggested file content"
    }
  ],
  "steps": ["step 1", "step 2"],
  "confidence": 0.85,
  "limitations": ["what you could not verify", "assumptions made"],
  "evidence": {
    "mode": "llm",
    "agentType": "smart-contract",
    "provider": "openai-compatible",
    "model": "MODEL_NAME",
    "generatedAt": "ISO_TIMESTAMP"
  }
}

Rules:
- confidence must be a number between 0.0 and 1.0
- findings must be an array (can be empty [])
- each finding severity must be one of: info, low, medium, high, critical
- answer must not be empty
- summary must not be empty
- evidence.mode must be "llm"
- evidence.agentType must be "smart-contract"`;

/**
 * Build messages array for LLM call from job data.
 * Strips all secrets before building prompt.
 *
 * @param {Object} job - ERC-8183 job object from API
 * @param {Object} opts
 * @param {string} opts.model - LLM model name for evidence field
 * @param {string} opts.providerAgentId - this provider's agent ID
 * @returns {Array} OpenAI messages array
 */
function buildMessages(job, { model, providerAgentId } = {}) {
  const inputPayload = job.inputPayload || {};
  const jobType = inputPayload.jobType || 'unknown';
  const requiredCapability = inputPayload.requiredCapability || '';
  const description = job.description || inputPayload.description || '';
  const query = inputPayload.query || '';
  const expectedDeliverable = inputPayload.expectedDeliverable || '';
  const acceptanceCriteria = inputPayload.acceptanceCriteria || '';
  const budget = job.budgetAtomic || job.priceAtomic || '';

  // Build user message with job spec — NO secrets
  const sections = [];

  sections.push(`## Job Information`);
  sections.push(`- localJobId: ${job.localJobId || job.id || 'unknown'}`);
  sections.push(`- erc8183JobId: ${job.erc8183JobId || 'unknown'}`);
  sections.push(`- jobType: ${jobType}`);
  sections.push(`- requiredCapability: ${requiredCapability}`);
  sections.push(`- providerAgentId: ${providerAgentId || 'unknown'}`);

  if (budget) {
    sections.push(`- budget: ${budget} atomic units`);
  }

  if (description) {
    sections.push(`\n## Description\n${description}`);
  }

  if (query) {
    sections.push(`\n## Query\n${query}`);
  }

  // Include full inputPayload minus secrets
  const safeInputPayload = sanitizePayload(inputPayload);
  if (Object.keys(safeInputPayload).length > 0) {
    sections.push(`\n## Input Payload\n\`\`\`json\n${JSON.stringify(safeInputPayload, null, 2)}\n\`\`\``);
  }

  if (expectedDeliverable) {
    sections.push(`\n## Expected Deliverable\n${expectedDeliverable}`);
  }

  if (acceptanceCriteria) {
    sections.push(`\n## Acceptance Criteria\n${acceptanceCriteria}`);
  }

  const systemPrompt = SYSTEM_PROMPT
    .replace('MODEL_NAME', model || 'unknown')
    .replace('ISO_TIMESTAMP', new Date().toISOString());

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: sections.join('\n') },
  ];
}

/**
 * Remove any fields that might contain secrets from a payload object.
 */
function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return {};

  const SECRET_KEYS = new Set([
    'privateKey', 'private_key', 'pk', 'secret', 'apiKey', 'api_key',
    'token', 'password', 'auth', 'authorization', 'walletKey',
    'signerKey', 'payerKey', 'evaluatorKey', 'providerKey',
  ]);

  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    const lower = key.toLowerCase();
    if (SECRET_KEYS.has(lower) || SECRET_KEYS.has(key)) continue;
    if (typeof value === 'string' && /^(0x[a-fA-F0-9]{64}|sk_|ak_)/.test(value)) continue;
    clean[key] = value;
  }
  return clean;
}

module.exports = { buildMessages, sanitizePayload, SYSTEM_PROMPT };
