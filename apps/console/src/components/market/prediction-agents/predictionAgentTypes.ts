export type PredictionAgentStatus = 'active' | 'synced' | 'unsynced';

export type PredictionAgentView = {
  id: string;
  name: string;
  role: string;
  category: string;
  endpoint: string;
  caps: string;
  event: string;
  seen: string;
  status: PredictionAgentStatus;
};

export type PredictionAgentInput = {
  id?: string | null;
  agentId?: string | null;
  name?: string | null;
  role?: unknown;
  category?: unknown;
  endpoint?: unknown;
  caps?: string[] | string | null;
  event?: unknown;
  seen?: unknown;
  status?: unknown;
};

const BLOCKED_PLACEHOLDER_NAMES = new Set(['arclayer llm market agent cluster']);

const ROLE_ALIASES: Record<string, string> = {
  analyst: 'ANALYZER',
  analysis: 'ANALYZER',
  analyzer: 'ANALYZER',
  evaluator: 'EVALUATOR',
  evaluation: 'EVALUATOR',
  executor: 'EXECUTOR',
  execute: 'EXECUTOR',
  oracle: 'ORACLE',
  market: 'MARKET-AGENT',
  'market-agent': 'MARKET-AGENT',
  market_agent: 'MARKET-AGENT',
  agent: 'AGENT',
};

export const FLOW_ROLE_ORDER = ['ORACLE', 'ANALYZER', 'EVALUATOR', 'MARKET-AGENT', 'AGENT', 'EXECUTOR'];

function text(value: unknown, fallback = '—') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function normalizeRole(value: unknown) {
  const raw = text(value, 'AGENT').toLowerCase();
  return ROLE_ALIASES[raw] ?? raw.toUpperCase();
}

function normalizeStatus(value: unknown): PredictionAgentStatus {
  const raw = text(value, 'unsynced').toLowerCase();
  if (raw === 'online' || raw === 'active') return 'active';
  if (raw === 'synced' || raw === 'ready') return 'synced';
  return 'unsynced';
}

function normalizeCaps(value: PredictionAgentInput['caps']) {
  if (Array.isArray(value)) return value.map((item) => text(item, '')).filter(Boolean).slice(0, 3).join(', ') || '—';
  return text(value);
}

function isBlockedPlaceholder(agent: PredictionAgentView) {
  return BLOCKED_PLACEHOLDER_NAMES.has(agent.name.toLowerCase());
}

export function normalizePredictionAgent(input: PredictionAgentInput): PredictionAgentView | null {
  const id = text(input.id ?? input.agentId, '');
  const name = text(input.name, id);

  if (!id || !name) return null;

  const agent = {
    id,
    name,
    role: normalizeRole(input.role),
    category: text(input.category, 'registered'),
    endpoint: text(input.endpoint),
    caps: normalizeCaps(input.caps),
    event: text(input.event, 'waiting'),
    seen: text(input.seen, 'offline'),
    status: normalizeStatus(input.status),
  } satisfies PredictionAgentView;

  return isBlockedPlaceholder(agent) ? null : agent;
}

export function normalizePredictionAgents(inputs: PredictionAgentInput[] = []) {
  return inputs.flatMap((input) => {
    const agent = normalizePredictionAgent(input);
    return agent ? [agent] : [];
  });
}

export function orderPredictionAgentsByFlow(agents: PredictionAgentView[]) {
  return [...agents].sort((a, b) => {
    const ai = FLOW_ROLE_ORDER.indexOf(a.role);
    const bi = FLOW_ROLE_ORDER.indexOf(b.role);
    const ar = ai === -1 ? FLOW_ROLE_ORDER.length : ai;
    const br = bi === -1 ? FLOW_ROLE_ORDER.length : bi;
    return ar - br || a.name.localeCompare(b.name);
  });
}
