import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';

export type ExternalAgentStatus = 'pending' | 'approved' | 'blocked';

export type ExternalAgentEntry = {
  agentId: string;
  address: string;
  owner: string;
  registrarAgentId: string;
  name?: string;
  endpoint?: string;
  capabilities: string[];
  status: ExternalAgentStatus;
  source: 'self-register';
  createdAt: string;
  updatedAt: string;
};

export type RegisterExternalAgentInput = {
  agentId: string;
  address: string;
  name?: string;
  endpoint?: string;
  capabilities?: string[];
  status: 'pending' | 'approved';
};

function registryPath(): string {
  return process.env.A2A_EXTERNAL_REGISTRY_PATH?.trim() || path.join(process.cwd(), 'data', 'a2a-external-registry.json');
}

async function ensureRegistryFile(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try { await readFile(filePath, 'utf8'); } catch { await writeFile(filePath, '[]\n', 'utf8'); }
}

async function readRegistryEntries(): Promise<ExternalAgentEntry[]> {
  const filePath = registryPath();
  await ensureRegistryFile(filePath);
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

export async function writeRegistryAtomically(entries: ExternalAgentEntry[]): Promise<void> {
  const filePath = registryPath();
  await ensureRegistryFile(filePath);
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

export async function listApprovedExternalAgents(): Promise<ExternalAgentEntry[]> {
  const entries = await readRegistryEntries();
  return entries.filter((entry) => entry.status === 'approved');
}

export async function getExternalAgent(agentId: string): Promise<ExternalAgentEntry | null> {
  const entries = await readRegistryEntries();
  return entries.find((entry) => entry.agentId === agentId) ?? null;
}

export async function listPendingExternalAgents(): Promise<ExternalAgentEntry[]> {
  const entries = await readRegistryEntries();
  return entries.filter((entry) => entry.status === 'pending');
}

export async function registerExternalAgent(input: RegisterExternalAgentInput): Promise<ExternalAgentEntry> {
  const entries = await readRegistryEntries();
  const now = new Date().toISOString();
  const existing = entries.find((entry) => entry.agentId === input.agentId);

  if (existing && existing.address.toLowerCase() !== input.address.toLowerCase()) {
    throw new Error('duplicate_agent_id_different_address');
  }

  if (existing) {
    existing.owner = input.address;
    existing.registrarAgentId = input.agentId;
    existing.name = input.name;
    existing.endpoint = input.endpoint;
    existing.capabilities = input.capabilities ?? [];
    existing.status = input.status;
    existing.updatedAt = now;
    await writeRegistryAtomically(entries);
    return existing;
  }

  const entry: ExternalAgentEntry = {
    agentId: input.agentId,
    address: input.address,
    owner: input.address,
    registrarAgentId: input.agentId,
    name: input.name,
    endpoint: input.endpoint,
    capabilities: input.capabilities ?? [],
    status: input.status,
    source: 'self-register',
    createdAt: now,
    updatedAt: now,
  };
  entries.push(entry);
  await writeRegistryAtomically(entries);
  return entry;
}

async function updateStatus(agentId: string, status: ExternalAgentStatus): Promise<ExternalAgentEntry | null> {
  const entries = await readRegistryEntries();
  const entry = entries.find((item) => item.agentId === agentId);
  if (!entry) return null;
  entry.status = status;
  entry.updatedAt = new Date().toISOString();
  await writeRegistryAtomically(entries);
  return entry;
}

export async function approveExternalAgent(agentId: string) { return updateStatus(agentId, 'approved'); }
export async function blockExternalAgent(agentId: string) { return updateStatus(agentId, 'blocked'); }
