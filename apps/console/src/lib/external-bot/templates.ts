/**
 * External bot template registry.
 *
 * Source of truth for all onboarding templates. Driven by AGENT_CATEGORIES.
 * Each template defines roles, scopes, runtime, and recommended mode.
 *
 * Adding a new bot category = new category in AGENT_CATEGORIES + template here.
 */

export type BotMode = 'bridge' | 'a2a-job-worker' | 'a2a-job-creator' | 'hybrid' | 'erc8183-commerce';

export type BotRuntime = 'pm2' | 'docker' | 'custom-http' | 'managed';

export type BotRole = {
  roleId: string;
  displayName: string;
  defaultAgentId: string;
  botRole: string;
  capabilities: string[];
  endpointPath: string;
  scopes: string[];
};

export type ExternalBotTemplate = {
  id: string;
  category: string;
  name: string;
  description: string;
  recommendedMode: BotMode;
  defaultPriceAtomic: string;
  defaultPriceLabel: string;
  defaultRuntime: BotRuntime;
  roles: BotRole[];
  availableRoles?: BotRole[];
  /** BOT_ROLE is fixed by runtime script (true for market-agent-bridge). */
  fixedBotRoleNames?: boolean;
  /** Boot sequence for multi-role PM2 templates. */
  bootSequence?: string[];
};

// ──────────────────────────────────────────────
// 7.1 — Prediction Market PM2 Bridge
// ──────────────────────────────────────────────
const predictionOracleRole: BotRole = {
  roleId: 'oracle',
  displayName: 'Hermes Oracle',
  defaultAgentId: 'hermes-oracle',
  botRole: 'oracle',
  capabilities: ['market_snapshot', 'market_data', 'orderbook', 'candles', 'btc_15m', 'polymarket_feed'],
  endpointPath: 'oracle-bot.js',
  scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
};

const predictionAnalyzerRole: BotRole = {
  roleId: 'analyzer',
  displayName: 'Apollo Analyzer',
  defaultAgentId: 'apollo-analyzer',
  botRole: 'analyzer',
  capabilities: ['resolver_output', 'market_signal', 'llm_analysis', 'probability_estimate', 'trend_analysis'],
  endpointPath: 'analyzer-bot.js',
  scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
};

const predictionEvaluatorRole: BotRole = {
  roleId: 'evaluator',
  displayName: 'Ignia Evaluator',
  defaultAgentId: 'ignia-evaluator',
  botRole: 'evaluator',
  capabilities: ['evaluation', 'risk_analysis', 'confidence_score', 'signal_validation', 'dry_run_decision'],
  endpointPath: 'evaluator-bot.js',
  scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
};

const predictionExecutorRole: BotRole = {
  roleId: 'executor',
  displayName: 'Budu Executor',
  defaultAgentId: 'budu-executor',
  botRole: 'executor',
  capabilities: ['execution_intent', 'dry_run_execution', 'x402_autopay', 'submit_proof', 'receipt_generation'],
  endpointPath: 'executor-bot.js',
  scopes: ['agent_bridge:write', 'agent_bridge:receipt', 'x402:pay'],
};

const predictionMarketPM2: ExternalBotTemplate = {
  id: 'prediction-market-pm2-bridge',
  category: 'prediction-market-bots',
  name: 'Prediction Market Bot',
  description: 'Default single-bot onboarding (Oracle) with optional multi-role PM2 pipeline: oracle → analyzer → evaluator → executor.',
  recommendedMode: 'hybrid',
  defaultPriceAtomic: '1000',
  defaultPriceLabel: '0.001 USDC',
  defaultRuntime: 'pm2',
  fixedBotRoleNames: true,
  bootSequence: ['oracle', 'analyzer', 'evaluator', 'executor'],
  roles: [predictionOracleRole],
  availableRoles: [predictionOracleRole, predictionAnalyzerRole, predictionEvaluatorRole, predictionExecutorRole],
};

// ──────────────────────────────────────────────
// ERC-8183 Escrow Job Bots
// ──────────────────────────────────────────────
const erc8183EscrowBots: ExternalBotTemplate = {
  id: 'erc8183-escrow-bots',
  category: 'erc8183-commerce',
  name: 'ERC-8183 Escrow Job Bots',
  description: '3-role on-chain escrow pipeline: client creates jobs, worker budgets + submits work, evaluator settles. PM2 runtime.',
  recommendedMode: 'erc8183-commerce',
  defaultPriceAtomic: '1000',
  defaultPriceLabel: 'on-chain escrow',
  defaultRuntime: 'pm2',
  fixedBotRoleNames: true,
  bootSequence: ['client', 'provider', 'evaluator'],
  roles: [
    {
      roleId: 'client',
      displayName: 'Client Bot',
      defaultAgentId: 'erc8183-client',
      botRole: 'client',
      capabilities: ['create_job', 'fund_escrow', 'approve_usdc', 'onchain_tx'],
      endpointPath: 'client-bot/index.js',
      scopes: ['agent_bridge:write', 'agent_bridge:receipt', 'erc8183:create', 'erc8183:confirm'],
    },
    {
      // Worker is the user-facing name. provider is the legacy runtime role name
      // used by the existing ERC-8183 example folder (provider-bot/).
      roleId: 'provider',
      displayName: 'Worker Bot',
      defaultAgentId: 'erc8183-provider',
      botRole: 'provider',
      capabilities: ['set_budget', 'claim_job', 'submit_work', 'onchain_tx'],
      endpointPath: 'provider-bot/index.js',
      scopes: ['agent_bridge:write', 'agent_bridge:receipt', 'erc8183:claim', 'erc8183:running', 'erc8183:submit'],
    },
    {
      roleId: 'evaluator',
      displayName: 'Evaluator Bot',
      defaultAgentId: 'erc8183-evaluator',
      botRole: 'evaluator',
      capabilities: ['evaluate', 'settle', 'complete_job', 'onchain_tx'],
      endpointPath: 'evaluator-bot/index.js',
      scopes: ['agent_bridge:write', 'agent_bridge:receipt', 'erc8183:complete', 'erc8183:tx'],
    },
  ],
};

// ──────────────────────────────────────────────
// 7.12 — Custom Worker
// ──────────────────────────────────────────────
const customWorker: ExternalBotTemplate = {
  id: 'custom-worker',
  category: 'custom-workers',
  name: 'Custom Worker',
  description: 'User-defined agent with custom role, scopes, and runtime. Bring your own script.',
  recommendedMode: 'bridge',
  defaultPriceAtomic: '1000',
  defaultPriceLabel: '0.001 USDC',
  defaultRuntime: 'custom-http',
  roles: [
    {
      roleId: 'worker',
      displayName: 'Custom Worker',
      defaultAgentId: 'custom-worker-agent',
      botRole: 'worker',
      capabilities: ['custom_input', 'custom_output', 'payload_hash', 'receipt_generation'],
      endpointPath: 'worker',
      scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
    },
  ],
};

// ──────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────
export const EXTERNAL_BOT_TEMPLATES: ExternalBotTemplate[] = [
  predictionMarketPM2,
  erc8183EscrowBots,
  customWorker,
];

export function getTemplatesByCategory(category: string): ExternalBotTemplate[] {
  return EXTERNAL_BOT_TEMPLATES.filter((t) => t.category === category);
}

export function getTemplate(id: string): ExternalBotTemplate | undefined {
  return EXTERNAL_BOT_TEMPLATES.find((t) => t.id === id);
}
