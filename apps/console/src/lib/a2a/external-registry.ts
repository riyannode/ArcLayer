import { promises as fs } from 'fs';

export type ExternalRegistryAgent = {
  agentId: string;
  address?: string;
  owner?: string;
  registrarAgentId?: string;
  name?: string;
  endpoint?: string;
  capabilities?: string[];
  status?: string;
  source?: string;
};

function normalize(value: string | undefined | null) {
  return String(value ?? '').trim().toLowerCase();
}

export async function listRegisteredExternalAgents(): Promise<ExternalRegistryAgent[]> {
  const registryPath = process.env.A2A_EXTERNAL_REGISTRY_PATH?.trim();
  if (!registryPath) return [];

  const owner = normalize(process.env.ARCLAYER_OWNER_ADDRESS);
  const arclayerAgentId = normalize(process.env.ARCLAYER_AGENT_ID);

  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const approved = parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as Record<string, unknown>)
      .filter((item) => typeof item.agentId === 'string' && item.agentId.trim().length > 0)
      .filter((item) => normalize(String(item.status ?? '')) === 'approved')
      .filter((item) => {
        if (!arclayerAgentId) return true;
        const registrar = normalize(typeof item.registrarAgentId === 'string' ? item.registrarAgentId : typeof item.registrar === 'string' ? item.registrar : undefined);
        return !registrar || registrar === arclayerAgentId;
      })
      .filter((item) => {
        if (!owner) return true;
        const itemOwner = normalize(typeof item.owner === 'string' ? item.owner : typeof item.address === 'string' ? item.address : undefined);
        return !itemOwner || itemOwner === owner;
      })
      .map((item) => ({
        agentId: String(item.agentId).trim(),
        address: typeof item.address === 'string' ? item.address : undefined,
        owner: typeof item.owner === 'string' ? item.owner : undefined,
        registrarAgentId: typeof item.registrarAgentId === 'string' ? item.registrarAgentId : typeof item.registrar === 'string' ? item.registrar : undefined,
        name: typeof item.name === 'string' ? item.name : undefined,
        endpoint: typeof item.endpoint === 'string' ? item.endpoint : undefined,
        capabilities: Array.isArray(item.capabilities) ? item.capabilities.filter((v): v is string => typeof v === 'string') : undefined,
        status: 'approved',
        source: typeof item.source === 'string' ? item.source : 'external-registry',
      }));

    console.info(`[a2a] registered external agents loaded count=${approved.length}`);
    return approved;
  } catch (error) {
    console.warn('[a2a] failed to load external registry', error instanceof Error ? error.message : 'unknown');
    return [];
  }
}

export async function isRegisteredExternalAgentId(agentId: string): Promise<boolean> {
  const normalized = normalize(agentId);
  if (!normalized) return false;
  const agents = await listRegisteredExternalAgents();
  return agents.some((agent) => normalize(agent.agentId) === normalized);
}
