export type AgentStatus = 'synced' | 'active' | 'idle' | 'unsynced';

export type AgentNode = {
  id: string;
  name: string;
  role: string;
  category: string;
  endpoint: string;
  caps: string;
  event: string;
  seen: string;
  status: AgentStatus;
  paymentMode?: string;
  updatedAt?: string;
  lastSeenAt?: string;
  isSynced?: boolean;
};

export type BackendAgentLike = {
  id?: string;
  agentId?: string;
  name?: string | null;
  role?: string | null;
  category?: string | null;
  categories?: string[];
  endpoint?: string | null;
  caps?: string | string[] | null;
  capabilities?: string[];
  event?: string | null;
  lastEvent?: string | null;
  summary?: string | null;
  seen?: string | null;
  status?: string | null;
  paymentMode?: string | null;
  updatedAt?: string | null;
  lastSeenAt?: string | null;
  isSynced?: boolean;
};

const FALLBACK_ROLES = ['EXECUTOR', 'EVALUATOR', 'ANALYST', 'WRITER', 'RISK'];

function short(value?: string | null, start = 12, end = 6) {
  if (!value) return '—';
  return value.length > start + end + 1 ? `${value.slice(0, start)}…${value.slice(-end)}` : value;
}

function normalizeCaps(agent: BackendAgentLike): string {
  if (Array.isArray(agent.caps)) return agent.caps.slice(0, 3).join(', ');
  if (typeof agent.caps === 'string' && agent.caps.trim()) return agent.caps;
  if (Array.isArray(agent.capabilities)) return agent.capabilities.slice(0, 3).join(', ');
  return 'market-watch, decision, x402';
}

function normalizeStatus(agent: BackendAgentLike): AgentStatus {
  if (agent.isSynced) return 'synced';
  const status = typeof agent.status === 'string' ? agent.status.toLowerCase() : '';
  if (status === 'synced' || status === 'active' || status === 'idle') return status;
  return 'unsynced';
}

export function normalizeAgent(agent: BackendAgentLike, index: number): AgentNode {
  const id = agent.id || agent.agentId || `agent-${index}`;
  return {
    id,
    name: agent.name || short(id, 10, 5),
    role: (agent.role || FALLBACK_ROLES[index % FALLBACK_ROLES.length] || 'AGENT').toUpperCase(),
    category: agent.category || agent.categories?.[0] || 'prediction-market-bots',
    endpoint: agent.endpoint || 'local/external',
    caps: normalizeCaps(agent),
    event: agent.event || agent.lastEvent || agent.summary || 'waiting for live decision',
    seen: agent.seen || short(agent.lastSeenAt || agent.updatedAt, 18, 0),
    status: normalizeStatus(agent),
    paymentMode: agent.paymentMode || undefined,
    updatedAt: agent.updatedAt || undefined,
    lastSeenAt: agent.lastSeenAt || undefined,
    isSynced: agent.isSynced,
  };
}

export function normalizeAgents(agents: BackendAgentLike[]): AgentNode[] {
  return agents.map((agent, index) => normalizeAgent(agent, index));
}
