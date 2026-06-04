/**
 * Role-Aware Provider Profile — generic prompt builder for all ERC-8183 provider roles.
 *
 * Builds OpenAI-compatible messages array from ERC-8183 job data.
 * Never includes secrets (private keys, API keys, wallet data).
 *
 * Replaces the previous smart-contract-only profile builder.
 * All dashboard roles (smart-contract, frontend, backend, devops, etc.)
 * route through this single generic builder.
 */

const DASHBOARD_PROVIDER_ROLES = {
  'smart-contract': {
    label: 'Smart Contract Agent',
    capabilities: ['smart-contract', 'solidity', 'foundry', 'smart-contract-review', 'smart-contract-debug', 'abi-integration', 'erc8004', 'erc8183', 'x402', 'security-review', 'code-review'],
    defaultCapability: 'solidity',
    expertise: 'Solidity, Foundry, ERC standards (ERC-8004, ERC-8183, ERC-20, ERC-721), smart contract auditing, gas optimization, and Arc Network (Circle\'s L1 where USDC is native gas).',
  },
  'frontend': {
    label: 'Frontend Agent',
    capabilities: ['frontend', 'react', 'nextjs', 'ui'],
    defaultCapability: 'frontend',
    expertise: 'React, Next.js, TypeScript, Tailwind CSS, responsive design, UI/UX implementation, component architecture, and web performance optimization.',
  },
  'backend': {
    label: 'Backend Agent',
    capabilities: ['backend', 'api', 'database', 'server'],
    defaultCapability: 'backend',
    expertise: 'Node.js, REST/GraphQL API design, database architecture (PostgreSQL, Redis), server-side logic, authentication, and microservices.',
  },
  'devops': {
    label: 'DevOps Agent',
    capabilities: ['devops', 'deployment', 'ci-cd', 'infra'],
    defaultCapability: 'devops',
    expertise: 'Docker, Kubernetes, CI/CD pipelines, cloud infrastructure (AWS, GCP), monitoring, logging, and deployment automation.',
  },
  'design': {
    label: 'Design Agent',
    capabilities: ['design', 'ux', 'ui-design', 'product-design'],
    defaultCapability: 'design',
    expertise: 'UI/UX design, design systems, Figma, accessibility (WCAG), user research, wireframing, and prototyping.',
  },
  'data-research': {
    label: 'Data Research Agent',
    capabilities: ['data-research', 'research', 'data-analysis'],
    defaultCapability: 'data-research',
    expertise: 'Data analysis, statistical methods, research methodology, data visualization, Python (pandas, numpy), and report writing.',
  },
  'documentation': {
    label: 'Documentation Agent',
    capabilities: ['documentation', 'technical-writing', 'docs'],
    defaultCapability: 'documentation',
    expertise: 'Technical writing, API documentation, README files, architecture docs, changelogs, and developer guides.',
  },
  'analysis': {
    label: 'Analysis Agent',
    capabilities: ['analysis', 'evaluation', 'reasoning'],
    defaultCapability: 'analysis',
    expertise: 'Critical analysis, evaluation frameworks, reasoning, report generation, and structured decision-making.',
  },
  'other': {
    label: 'Other',
    capabilities: ['general', 'other'],
    defaultCapability: 'general',
    expertise: 'General-purpose task execution, analysis, and problem-solving across multiple domains.',
  },
};

/**
 * Build the system prompt for a given provider role.
 * The LLM must return strict JSON with the required shape.
 *
 * @param {string} agentType - role slug (e.g. 'smart-contract', 'frontend')
 * @param {string} roleLabel - human-readable label (e.g. 'Smart Contract Agent')
 * @param {string} expertise - domain expertise description
 * @returns {string} system prompt
 */
function buildSystemPrompt(agentType, roleLabel, expertise) {
  return `You are ${roleLabel}, an expert AI agent specializing in ${expertise}

You are executing an ERC-8183 agentic commerce job on Arc Network.

You MUST respond with strict JSON only. No markdown fences. No prose outside the JSON object. No chain-of-thought outside the JSON.

Required JSON shape:
{
  "summary": "short result summary (1-2 sentences)",
  "answer": "main deliverable — the actual analysis, code, or recommendation",
  "findings": [
    {
      "severity": "info|low|medium|high|critical",
      "title": "short finding title",
      "description": "detailed explanation",
      "recommendation": "what to do about it"
    }
  ],
  "recommendations": ["actionable recommendation 1", "actionable recommendation 2"],
  "confidence": 0.85,
  "evidence": {
    "mode": "llm",
    "agentType": "${agentType}",
    "jobType": "<from job input>",
    "requiredCapability": "<from job input>"
  }
}

Rules:
- confidence must be a number between 0.0 and 1.0
- findings must be an array (can be empty [])
- each finding severity must be one of: info, low, medium, high, critical
- answer must not be empty
- summary must not be empty
- evidence.mode must be "llm"
- evidence.agentType must be "${agentType}"`;
}

/**
 * Build messages array for LLM call from job data.
 * Strips all secrets before building prompt.
 *
 * @param {Object} job - ERC-8183 job object from API
 * @param {Object} opts
 * @param {string} opts.model - LLM model name for logging
 * @param {string} opts.providerAgentId - this provider's agent ID
 * @param {string} opts.agentType - role slug (e.g. 'smart-contract')
 * @param {string} [opts.roleLabel] - human-readable role label
 * @param {string[]} [opts.capabilities] - provider capabilities
 * @returns {Array} OpenAI messages array
 */
function buildMessages(job, { model, providerAgentId, agentType, roleLabel, capabilities } = {}) {
  const roleConfig = DASHBOARD_PROVIDER_ROLES[agentType] || DASHBOARD_PROVIDER_ROLES['other'];
  const resolvedLabel = roleLabel || roleConfig.label;
  const resolvedAgentType = agentType || 'other';

  const inputPayload = job.inputPayload || {};
  const jobType = inputPayload.jobType || 'unknown';
  const requiredCapability = inputPayload.requiredCapability || '';
  const description = job.description || inputPayload.description || '';
  const query = inputPayload.query || '';
  const task = inputPayload.task || '';
  const instructions = inputPayload.instructions || '';
  const expectedDeliverable = inputPayload.expectedDeliverable || '';
  const acceptanceCriteria = inputPayload.acceptanceCriteria || '';
  const budget = job.budgetAtomic || job.priceAtomic || '';

  // Build user message with job spec — NO secrets
  const sections = [];

  sections.push(`## Agent Context`);
  sections.push(`- You are: ${resolvedLabel}`);
  sections.push(`- Agent type: ${resolvedAgentType}`);
  if (capabilities && capabilities.length > 0) {
    sections.push(`- Your capabilities: ${capabilities.join(', ')}`);
  }

  sections.push(`\n## Job Information`);
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

  if (task) {
    sections.push(`\n## Task\n${task}`);
  }

  if (instructions) {
    sections.push(`\n## Instructions\n${instructions}`);
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

  const systemPrompt = buildSystemPrompt(resolvedAgentType, resolvedLabel, roleConfig.expertise);

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

  const SECRET_PATTERNS = /private[_]?key|api[_]?key|secret|token|password|auth|mnemonic|seed|authorization|cookie/i;
  const SECRET_EXACT = new Set(['pk', 'walletKey', 'signerKey', 'payerKey', 'evaluatorKey', 'providerKey']);

  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    // Skip keys matching secret patterns or exact legacy names
    if (SECRET_PATTERNS.test(key) || SECRET_EXACT.has(key)) continue;
    // Skip values that look like private keys, API keys, or auth tokens
    if (typeof value === 'string' && /^(0x[a-fA-F0-9]{64}|sk_|ak_|bearer\s)/i.test(value)) continue;
    clean[key] = value;
  }
  return clean;
}

module.exports = {
  buildMessages,
  sanitizePayload,
  buildSystemPrompt,
  DASHBOARD_PROVIDER_ROLES,
};
