import 'dotenv/config';

export type WorkerRole = 'creator' | 'submitter' | 'evaluator';

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function role(): WorkerRole {
  const raw = process.env.WORKER_ROLE || 'submitter';
  if (raw === 'creator' || raw === 'submitter' || raw === 'evaluator') return raw;
  throw new Error(`Invalid WORKER_ROLE=${raw}. Expected creator | submitter | evaluator.`);
}

export const config = {
  arclayerBaseUrl: process.env.ARCLAYER_BASE_URL || 'https://arclayers.xyz',
  arclayerAgentId: process.env.ARCLAYER_AGENT_ID || '',
  arclayerApiKey: process.env.ARCLAYER_API_KEY || '',
  arcRpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  arcRpcFallbackUrl: process.env.ARC_RPC_FALLBACK_URL || 'https://rpc.drpc.testnet.arc.network',
  workerPrivateKey: process.env.WORKER_PRIVATE_KEY || '',
  evaluatorPrivateKey: process.env.EVALUATOR_PRIVATE_KEY || '',
  role: role(),
  pollIntervalMs: num('POLL_INTERVAL_MS', 600_000),
  dryRun: bool('DRY_RUN', true),
  maxJobsPerRun: Math.max(1, num('MAX_JOBS_PER_RUN', 1)),
  concurrency: Math.max(1, num('CONCURRENCY', 1)),
  maxLlmCallsPerJob: Math.max(0, num('MAX_LLM_CALLS_PER_JOB', 1)),
  llmProvider: process.env.LLM_PROVIDER || 'pioneer',
  pioneerBaseUrl: process.env.PIONEER_BASE_URL || 'https://agent.pioneer.ai',
  pioneerApiKey: process.env.PIONEER_API_KEY || '',
  pioneerModel: process.env.PIONEER_MODEL || 'arc-a2a-worker',
  maxTokens: num('MAX_TOKENS', 800),
  temperature: num('TEMPERATURE', 0.2),
  dailyUsdCap: num('DAILY_USD_CAP', 5),
  enableX402CreateJob: bool('ENABLE_X402_CREATE_JOB', false),
  enableOnchainSubmit: bool('ENABLE_ONCHAIN_SUBMIT', true),
  enableOnchainComplete: bool('ENABLE_ONCHAIN_COMPLETE', true),
  creatorJobTitle: process.env.CREATOR_JOB_TITLE || 'API-first A2A worker request',
  creatorJobDescription: process.env.CREATOR_JOB_DESCRIPTION || 'Produce a concise ArcLayer A2A deliverable.',
  creatorJobCategory: process.env.CREATOR_JOB_CATEGORY || 'general',
  creatorJobRoleId: process.env.CREATOR_JOB_ROLE_ID || 'submitter',
} as const;

export function requireRuntimeEnv(): void {
  if (!config.arclayerAgentId && config.role !== 'creator') throw new Error('ARCLAYER_AGENT_ID is required for submitter/evaluator workers.');
  if (!config.arclayerApiKey && config.role !== 'creator') throw new Error('ARCLAYER_API_KEY is required for submitter/evaluator workers.');
  if (!config.dryRun && config.role === 'submitter' && config.enableOnchainSubmit && !config.workerPrivateKey) throw new Error('WORKER_PRIVATE_KEY is required for live on-chain submit.');
  if (!config.dryRun && config.role === 'evaluator' && config.enableOnchainComplete && !config.evaluatorPrivateKey) throw new Error('EVALUATOR_PRIVATE_KEY is required for live on-chain complete.');
}
