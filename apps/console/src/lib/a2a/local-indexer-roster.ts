// Prediction-market bot visibility in local-indexer mode requires metadataURI under
// https://agent.arclayers.xyz/metadata/... (or configured A2A_AGENT_METADATA_HOST)
// and manifest categories/roles containing "prediction-market-bots".
export type LocalIndexerAgent = {
  id?: string | number;
  agentId?: string | number;
  name?: string;
  controller?: string | null;
  metadataURI?: string | null;
  metadataUri?: string | null;
  source?: string;
};

export type LocalAgentManifest = {
  schema?: string;
  version?: number;
  agentId?: string;
  name?: string;
  role?: string;
  description?: string;
  controller?: string;
  endpoint?: string | null;
  namespace?: string;
  registeredVia?: string;
  categories?: string[];
  capability?: string[];
  capabilities?: string[];
  roles?: Array<{
    id?: string;
    name?: string;
    category?: string;
    provider?: string;
    model?: string;
    endpointPath?: string;
    capabilities?: string[];
    enabled?: boolean;
  }>;
  connectedTo?: {
    agentId?: string;
    role?: string;
  };
  connections?: Array<{
    targetAgentId?: string;
    targetRole?: string;
    role?: string;
    status?: string;
  }>;
  x402?: unknown;
  createdAt?: string;
  updatedAt?: string;
};

const INDEXER_FETCH_TIMEOUT_MS = 5_000;
const METADATA_FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 30_000;

const categoryCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof listLocalIndexerAgentsByCategoryUncached>> }>();

export function metadataUriOf(agent: LocalIndexerAgent): string | null {
  return agent.metadataURI ?? agent.metadataUri ?? null;
}

export function agentIdOf(agent: LocalIndexerAgent, manifest?: LocalAgentManifest): string {
  return String(manifest?.agentId ?? agent.agentId ?? agent.id ?? '');
}

function normalizeIndexerBaseUrl(raw: string): string {
  let val = raw.trim();
  if (!val) return 'http://127.0.0.1:3535';
  if (!val.startsWith('http://') && !val.startsWith('https://')) {
    val = `http://${val}`;
  }
  return val.replace(/\/+$/, '');
}

function normalizeMetadataHost(raw: string): string {
  const val = raw.trim();
  if (!val) return 'agent.arclayers.xyz';
  try {
    if (val.startsWith('http://') || val.startsWith('https://')) {
      return new URL(val).hostname.toLowerCase();
    }
    return val.replace(/\/+$/, '').toLowerCase();
  } catch {
    return val.replace(/\/+$/, '').toLowerCase();
  }
}

function allowedMetadataHost(): string {
  return normalizeMetadataHost(process.env.A2A_AGENT_METADATA_HOST || '');
}

function isAllowedMetadataUri(uri: string): boolean {
  try {
    return new URL(uri).hostname.toLowerCase() === allowedMetadataHost();
  } catch {
    return false;
  }
}

function hasCategory(manifest: LocalAgentManifest, category: string): boolean {
  return (
    manifest.categories?.includes(category) ||
    manifest.roles?.some((role) => role.category === category) ||
    false
  );
}

function getVisibleAgentIdSet(): Set<string> | null {
  const raw =
    process.env.A2A_VISIBLE_AGENT_IDS ||
    process.env.NEXT_PUBLIC_A2A_VISIBLE_AGENT_IDS ||
    '';

  const ids = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return ids.length > 0 ? new Set(ids) : null;
}

function passesOptionalVisibleFilter(agentId: string): boolean {
  const visible = getVisibleAgentIdSet();
  if (!visible) return true;
  return visible.has(String(agentId));
}

function cacheKeyForCategory(category: string): string {
  const indexer = process.env.A2A_LOCAL_INDEXER_URL?.trim() || '';
  const host = process.env.A2A_AGENT_METADATA_HOST?.trim() || 'agent.arclayers.xyz';
  const visible = process.env.A2A_VISIBLE_AGENT_IDS || process.env.NEXT_PUBLIC_A2A_VISIBLE_AGENT_IDS || '';
  return [category, indexer, host, visible].join('|');
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: 'no-store',
      next: { revalidate: 0 },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function listLocalIndexerAgentsByCategoryUncached(category: string) {
  const base = normalizeIndexerBaseUrl(process.env.A2A_LOCAL_INDEXER_URL || '');

  const res = await fetchWithTimeout(`${base}/agents`, INDEXER_FETCH_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`local indexer HTTP ${res.status}`);
  }

  const json = await res.json();

  const indexerAgents: LocalIndexerAgent[] = Array.isArray(json)
    ? json
    : Array.isArray(json.agents)
      ? json.agents
      : Array.isArray(json.data)
        ? json.data
        : [];

  const output = [];

  for (const indexerAgent of indexerAgents) {
    const metadataURI = metadataUriOf(indexerAgent);
    if (!metadataURI) continue;
    if (!isAllowedMetadataUri(metadataURI)) continue;

    let manifestRes: Response;
    try {
      manifestRes = await fetchWithTimeout(metadataURI, METADATA_FETCH_TIMEOUT_MS);
    } catch {
      continue;
    }

    if (!manifestRes.ok) continue;

    const manifest = (await manifestRes.json().catch(() => null)) as LocalAgentManifest | null;
    if (!manifest || typeof manifest !== 'object') continue;

    if (!hasCategory(manifest, category)) continue;

    const agentId = agentIdOf(indexerAgent, manifest);
    if (!agentId) continue;
    if (!passesOptionalVisibleFilter(agentId)) continue;

    output.push({
      agentId,
      name: manifest.name ?? indexerAgent.name ?? `Agent ${agentId}`,
      role: manifest.role ?? manifest.roles?.[0]?.id ?? null,
      endpoint: manifest.endpoint ?? null,
      categories: manifest.categories ?? [],
      roles: manifest.roles ?? [],
      capabilities: manifest.capabilities ?? manifest.capability ?? [],
      x402: manifest.x402 ?? null,
      controller: manifest.controller ?? indexerAgent.controller ?? null,
      metadataURI,
      connectedTo: manifest.connectedTo ?? null,
      connections: manifest.connections ?? [],
      updatedAt: manifest.updatedAt ?? null,
      manifest,
      indexerUrl: base,
      metadataHost: allowedMetadataHost(),
    });
  }

  return output;
}

export async function listLocalIndexerAgentsByCategory(category: string) {
  const key = cacheKeyForCategory(category);
  const now = Date.now();
  const cached = categoryCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await listLocalIndexerAgentsByCategoryUncached(category);
  categoryCache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export async function listLocalIndexerAgentIdsByCategory(category: string): Promise<string[]> {
  const agents = await listLocalIndexerAgentsByCategory(category);
  return agents.map((agent) => String(agent.agentId));
}
