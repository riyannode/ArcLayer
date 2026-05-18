import type { RegisteredAgentMetadata } from '@/types/agent-network';
import { parseAgentName } from '@/lib/agentName';
import { getManifest, getManifests } from './store';
import { isManifestPointerURI, extractAgentIdFromPointer } from './sign';
import type { AgentManifestV1, StoredAgentManifest } from './types';

/**
 * Resolve a metadataURI to agent metadata.
 *
 * Dispatch logic:
 *   arclayer://manifest/<agentId>  → Supabase store
 *   arclayer://agent/<name>?...    → legacy URL-params parser (inline)
 *   https:// | ipfs://             → HTTP fetch (existing behavior, passthrough)
 *   anything else                  → null
 */
export async function resolveManifestMetadata(
  metadataURI: string,
  agentId?: string
): Promise<RegisteredAgentMetadata | null> {
  if (!metadataURI) return null;

  // 1. New manifest pointer → Supabase
  if (isManifestPointerURI(metadataURI)) {
    const id = extractAgentIdFromPointer(metadataURI) || agentId;
    if (!id) return null;
    const stored = await getManifest(id);
    if (!stored) return null;
    return manifestToMetadata(stored.manifest);
  }

  // 2. Legacy arclayer://agent/<name>?... → parse URL params
  if (metadataURI.startsWith('arclayer://agent/')) {
    return parseLegacyAgentURI(metadataURI);
  }

  // 3. HTTP/IPFS — return null here; the existing fetchMetadata in route.ts handles these.
  //    This resolver only handles arclayer:// schemes.
  return null;
}

/**
 * Batch resolve for multiple agents. Optimizes Supabase calls.
 */
export async function resolveManifestMetadataBatch(
  agents: { agentId: string; metadataURI: string }[]
): Promise<Map<string, RegisteredAgentMetadata>> {
  const result = new Map<string, RegisteredAgentMetadata>();

  // Separate by scheme
  const supabaseIds: string[] = [];
  const legacyAgents: { agentId: string; metadataURI: string }[] = [];

  for (const agent of agents) {
    if (isManifestPointerURI(agent.metadataURI)) {
      const id = extractAgentIdFromPointer(agent.metadataURI) || agent.agentId;
      if (id) supabaseIds.push(id);
    } else if (agent.metadataURI.startsWith('arclayer://agent/')) {
      legacyAgents.push(agent);
    }
    // HTTP/IPFS handled by existing fetchMetadata — skip here
  }

  // Batch Supabase read
  if (supabaseIds.length > 0) {
    const stored = await getManifests(supabaseIds);
    stored.forEach((s, id) => {
      result.set(id, manifestToMetadata(s.manifest));
    });
  }

  // Legacy inline parse
  for (const agent of legacyAgents) {
    const meta = parseLegacyAgentURI(agent.metadataURI);
    if (meta) result.set(agent.agentId, meta);
  }

  return result;
}

/** Convert full manifest to the RegisteredAgentMetadata shape used by the UI. */
function manifestToMetadata(m: AgentManifestV1): RegisteredAgentMetadata {
  return {
    name: m.name,
    role: m.role,
    description: m.description,
    capability: m.capability,
    categories: m.categories as RegisteredAgentMetadata['categories'],
    autonomous: true,
    endpoint: m.endpoint,
    mode: m.mode,
    price: m.price,
    avatar: m.avatar,
  };
}

/** Parse legacy arclayer://agent/<name>?autonomous=true&endpoint=...&... */
function parseLegacyAgentURI(uri: string): RegisteredAgentMetadata | null {
  const name = parseAgentName(uri);
  if (!name) return null;

  const qIdx = uri.indexOf('?');
  const params = qIdx >= 0 ? new URLSearchParams(uri.slice(qIdx + 1)) : null;

  return {
    name,
    role: params?.get('role') || undefined,
    description: params?.get('description') || undefined,
    capability: params?.get('capability')?.split(',').filter(Boolean) || undefined,
    categories: (params?.get('categories')?.split(',').filter(Boolean) as RegisteredAgentMetadata['categories']) || undefined,
    autonomous: params?.get('autonomous') === 'true' || undefined,
    endpoint: params?.get('endpoint') || undefined,
    mode: (params?.get('mode') as RegisteredAgentMetadata['mode']) || undefined,
    price: params?.get('price') || undefined,
  };
}

export type { StoredAgentManifest };
