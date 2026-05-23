import { promises as fs } from 'fs';
import path from 'path';

export type ExternalRegistryStatus = 'pending' | 'approved' | 'blocked';

export type ExternalRegistryAgent = {
  agentId: string;
  address?: string;
  owner?: string;
  registrarAgentId?: string;
  name?: string;
  endpoint?: string;
  capabilities?: string[];
  status?: ExternalRegistryStatus;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type RegisterExternalAgentInput = {
  agentId: string;
  address: string;
  owner?: string;
  registrarAgentId?: string;
  name?: string;
  endpoint?: string;
  capabilities?: string[];
  status?: ExternalRegistryStatus;
  source?: string;
};

function normalize(value: string | undefined | null) {
  return String(value ?? '').trim().toLowerCase();
}

function getRegistryPath(required: boolean): string | null {
  const registryPath = process.env.A2A_EXTERNAL_REGISTRY_PATH?.trim();
  if (!registryPath) {
    if (required) throw new Error('external_registry_path_not_configured');
    return null;
  }
  return registryPath;
}

async function readRegistry(registryPath: string): Promise<Record<string, unknown>[]> {
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') as Record<string, unknown>[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeRegistry(registryPath: string, entries: Record<string, unknown>[]) {
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  const tmpPath = `${registryPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, JSON.stringify(entries, null, 2));
  await fs.rename(tmpPath, registryPath);
}

function toAgent(item: Record<string, unknown>): ExternalRegistryAgent | null {
  if (typeof item.agentId !== 'string' || item.agentId.trim().length === 0) return null;
  const normalizedStatus = normalize(typeof item.status === 'string' ? item.status : '');
  const status: ExternalRegistryStatus = normalizedStatus === 'blocked' ? 'blocked' : normalizedStatus === 'pending' ? 'pending' : 'approved';
  return {
    agentId: String(item.agentId).trim(),
    address: typeof item.address === 'string' ? item.address : undefined,
    owner: typeof item.owner === 'string' ? item.owner : undefined,
    registrarAgentId: typeof item.registrarAgentId === 'string' ? item.registrarAgentId : typeof item.registrar === 'string' ? item.registrar : undefined,
    name: typeof item.name === 'string' ? item.name : undefined,
    endpoint: typeof item.endpoint === 'string' ? item.endpoint : undefined,
    capabilities: Array.isArray(item.capabilities) ? item.capabilities.filter((v): v is string => typeof v === 'string') : undefined,
    status,
    source: typeof item.source === 'string' ? item.source : 'external-registry',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
  };
}

function applyFilters(agents: ExternalRegistryAgent[]): ExternalRegistryAgent[] {
  const owner = normalize(process.env.ARCLAYER_OWNER_ADDRESS);
  const arclayerAgentId = normalize(process.env.ARCLAYER_AGENT_ID);

  return agents
    .filter((item) => normalize(item.status) === 'approved')
    .filter((item) => {
      if (!arclayerAgentId) return true;
      const registrar = normalize(item.registrarAgentId);
      return !registrar || registrar === arclayerAgentId;
    })
    .filter((item) => {
      if (!owner) return true;
      const itemOwner = normalize(item.owner ?? item.address);
      return !itemOwner || itemOwner === owner;
    });
}

async function listExternalAgentsAll(): Promise<ExternalRegistryAgent[]> {
  const registryPath = getRegistryPath(false);
  if (!registryPath) return [];
  try {
    const parsed = await readRegistry(registryPath);
    return parsed.map(toAgent).filter((item): item is ExternalRegistryAgent => item !== null);
  } catch (error) {
    console.warn('[a2a] failed to load external registry', error instanceof Error ? error.message : 'unknown');
    return [];
  }
}

export async function listRegisteredExternalAgents(): Promise<ExternalRegistryAgent[]> {
  const approved = applyFilters(await listExternalAgentsAll());
  console.info(`[a2a] registered external agents loaded count=${approved.length}`);
  return approved;
}

export async function listPendingExternalAgents(): Promise<ExternalRegistryAgent[]> {
  const agents = await listExternalAgentsAll();
  return agents.filter((agent) => normalize(agent.status) === 'pending');
}

export async function getExternalAgent(agentId: string): Promise<ExternalRegistryAgent | null> {
  const normalized = normalize(agentId);
  if (!normalized) return null;
  const agents = await listExternalAgentsAll();
  return agents.find((agent) => normalize(agent.agentId) === normalized) ?? null;
}

export async function registerExternalAgent(input: RegisterExternalAgentInput): Promise<{ agent: ExternalRegistryAgent; created: boolean }> {
  const registryPath = getRegistryPath(true) as string;
  const entries = await readRegistry(registryPath);

  const normalizedAgentId = normalize(input.agentId);
  const normalizedAddress = normalize(input.address);
  const now = new Date().toISOString();

  const duplicateByAgentId = entries.find((entry) => normalize(typeof entry.agentId === 'string' ? entry.agentId : '') === normalizedAgentId);
  if (duplicateByAgentId && normalize(typeof duplicateByAgentId.address === 'string' ? duplicateByAgentId.address : '') !== normalizedAddress) {
    throw new Error('duplicate_agent_id');
  }

  const index = entries.findIndex((entry) => normalize(typeof entry.agentId === 'string' ? entry.agentId : '') === normalizedAgentId && normalize(typeof entry.address === 'string' ? entry.address : '') === normalizedAddress);
  const existing = index >= 0 ? toAgent(entries[index]) : null;

  const status = input.status ?? existing?.status ?? 'pending';
  const next: ExternalRegistryAgent = {
    agentId: input.agentId.trim(),
    address: input.address,
    owner: input.owner,
    registrarAgentId: input.registrarAgentId,
    name: input.name,
    endpoint: input.endpoint,
    capabilities: input.capabilities,
    status,
    source: input.source ?? existing?.source ?? 'external-registry',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (index >= 0) entries[index] = next as Record<string, unknown>;
  else entries.push(next as Record<string, unknown>);

  await writeRegistry(registryPath, entries);
  return { agent: next, created: index < 0 };
}

async function setExternalAgentStatus(agentId: string, status: ExternalRegistryStatus): Promise<ExternalRegistryAgent | null> {
  const registryPath = getRegistryPath(true) as string;
  const entries = await readRegistry(registryPath);
  const normalized = normalize(agentId);
  const index = entries.findIndex((entry) => normalize(typeof entry.agentId === 'string' ? entry.agentId : '') === normalized);
  if (index < 0) return null;
  const existing = toAgent(entries[index]);
  if (!existing) return null;
  const updated: ExternalRegistryAgent = { ...existing, status, updatedAt: new Date().toISOString() };
  entries[index] = updated as Record<string, unknown>;
  await writeRegistry(registryPath, entries);
  return updated;
}

export async function approveExternalAgent(agentId: string) {
  return setExternalAgentStatus(agentId, 'approved');
}

export async function blockExternalAgent(agentId: string) {
  return setExternalAgentStatus(agentId, 'blocked');
}

export async function isRegisteredExternalAgentId(agentId: string): Promise<boolean> {
  const normalized = normalize(agentId);
  if (!normalized) return false;
  const agents = await listRegisteredExternalAgents();
  return agents.some((agent) => normalize(agent.agentId) === normalized);
}

export function externalRegistryEnforcementEnabled(): boolean {
  return process.env.A2A_AGENT_ROSTER_SOURCE === 'registered-only' ||
    process.env.A2A_ENFORCE_EXTERNAL_REGISTRY === 'true';
}

export async function requireRegisteredExternalAgent(agentId: string): Promise<boolean> {
  if (!externalRegistryEnforcementEnabled()) return true;
  return isRegisteredExternalAgentId(agentId);
}
