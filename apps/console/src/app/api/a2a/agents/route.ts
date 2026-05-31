import { NextResponse } from 'next/server';
import { indexerUrl } from '@/lib/indexer';
import type { Hex } from 'viem';
import { isHiddenAgent } from '@/lib/a2a/hidden-agents';
import {
  getCanonicalProfileMode,
  shouldExposeAgent,
  platformSortRank,
  getAgentBadge,
  type CanonicalAgentSource,
  type CanonicalAgentLike,
} from '@/lib/a2a/profile/filter';
import { resolveManifestMetadata } from '@/lib/a2a/manifest';
import { listStoredManifests } from '@/lib/a2a/roster';
import { listRegisteredExternalAgents } from '@/lib/a2a/external-registry';
import { CONTRACTS } from '@arclayer/sdk';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const AGENTS_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';

// ERC-8004 Identity Registry — used for response metadata only (no legacy chain scan)
const AGENT_REGISTRY = CONTRACTS.ERC8004_IDENTITY_REGISTRY as Hex;

function normalizeAgentIdentity(input: {
  agentId?: unknown;
  tokenId?: unknown;
  controller?: unknown;
  owner?: unknown;
  source?: unknown;
}) {
  const rawTokenId = input.tokenId === undefined || input.tokenId === null
    ? ''
    : String(input.tokenId).trim();

  const rawAgentId = input.agentId === undefined || input.agentId === null
    ? ''
    : String(input.agentId).trim();

  // ERC-8004 canonical identity: tokenId. Fallback to agentId for web/external agents.
  const canonicalId = rawTokenId || rawAgentId;

  return {
    agentId: canonicalId,
    tokenId: rawTokenId || (/^\d+$/.test(rawAgentId) ? rawAgentId : null),
    owner: typeof input.owner === 'string' && input.owner ? input.owner : undefined,
    controller: typeof input.controller === 'string' ? input.controller : '',
    source: typeof input.source === 'string' && input.source
      ? input.source
      : rawTokenId || /^\d+$/.test(rawAgentId)
        ? 'erc8004_identity_registry'
        : 'web_manifest',
  };
}

const MAX_METADATA_BYTES = 32_000;
const METADATA_CONCURRENCY = 6;

type AgentMetadata = {
  name?: string;
  role?: string;
  description?: string;
  capability?: string[];
  categories?: string[];
  autonomous?: boolean;
  avatar?: string;
  endpoint?: string;
  mode?: 'seller' | 'buyer' | 'dual';
  price?: string;
  skills?: string[];
  endpoints?: string[];
  x402?: string;
  mcp?: string;
};

type IndexerAgent = {
  agentId: string;
  tokenId?: string | null;
  controller: string;
  skillHash?: string;
  metadataURI: string;
  registeredAt?: string;
  reputationScore?: string;
  score?: string;
  jobs?: string[];
  proofTokenIds?: string[];
  source?: string;
};

type CanonicalErc8004Agent = {
  agentId: string;
  tokenId?: string | null;
  owner?: string;
  controller: string;
  metadataURI?: string;
  metadata?: AgentMetadata | null;
  source?: string;
  chainId?: string;
  registryAddress?: string;
  txHash?: string;
  blockNumber?: string;
  mintedAt?: string;
  updatedAt?: string;
  onchain?: boolean;
};

function ipfsToGateway(uri: string) {
  if (!uri.startsWith('ipfs://')) return uri;
  return `https://ipfs.io/ipfs/${uri.slice('ipfs://'.length)}`;
}

function isSafeHttpUri(uri: string) {
  try {
    const url = new URL(ipfsToGateway(uri));
    // Only HTTPS allowed. http:// is unsafe for metadata fetches.
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isArcLayersProfileUri(uri: string) {
  if (!isSafeHttpUri(uri)) return false;
  try {
    const url = new URL(ipfsToGateway(uri));
    return url.protocol === 'https:' && url.hostname === 'arclayers.xyz';
  } catch {
    return false;
  }
}

async function fetchMetadata(uri: string, agentId?: string): Promise<AgentMetadata | null> {
  // Try manifest resolver first (handles arclayer://manifest/ and arclayer://agent/ schemes).
  const resolved = await resolveManifestMetadata(uri, agentId);
  if (resolved) {
    return {
      name: resolved.name,
      role: resolved.role,
      description: resolved.description,
      capability: resolved.capability,
      categories: resolved.categories,
      autonomous: resolved.autonomous,
      avatar: resolved.avatar,
      endpoint: resolved.endpoint,
      mode: resolved.mode,
      price: resolved.price,
    };
  }

  if (!uri || !isArcLayersProfileUri(uri)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(ipfsToGateway(uri), {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json,text/plain;q=0.8,*/*;q=0.1' },
    });
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, MAX_METADATA_BYTES);
    const json = JSON.parse(text);
    if (!json || typeof json !== 'object') return null;
    return {
      name: typeof json.name === 'string' ? json.name : undefined,
      role: typeof json.role === 'string' ? json.role : undefined,
      description: typeof json.description === 'string' ? json.description : undefined,
      capability: Array.isArray(json.capability) ? json.capability.filter((x: unknown) => typeof x === 'string').slice(0, 8) : undefined,
      categories: Array.isArray(json.categories) ? json.categories.filter((x: unknown) => typeof x === 'string').slice(0, 6) : undefined,
      autonomous: typeof json.autonomous === 'boolean' ? json.autonomous : undefined,
      avatar: typeof json.avatar === 'string' ? json.avatar : undefined,
      skills: Array.isArray(json.skills) ? json.skills.filter((x: unknown) => typeof x === 'string').slice(0, 16) : undefined,
      endpoints: Array.isArray(json.endpoints) ? json.endpoints.filter((x: unknown) => typeof x === 'string').slice(0, 16) : undefined,
      x402: typeof json.x402 === 'string' ? json.x402 : undefined,
      mcp: typeof json.mcp === 'string' ? json.mcp : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchIndexerAgents(origin: string): Promise<IndexerAgent[]> {
  try {
    void origin;

    const res = await fetch(indexerUrl('/agents'), { cache: 'no-store' });

    if (!res.ok) {
      throw new Error(`indexer_agents_unavailable:${res.status}`);
    }

    const data = await res.json();

    if (Array.isArray(data)) return data as IndexerAgent[];
    if (Array.isArray(data?.agents)) return data.agents as IndexerAgent[];

    throw new Error('indexer_agents_invalid_response');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'indexer_agents_fetch_failed';
    throw new Error(message);
  }
}

async function fetchCanonicalErc8004Agents(): Promise<CanonicalErc8004Agent[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('erc8004_agents')
    .select(
      'token_id,agent_id,owner,controller,metadata_uri,metadata_json,source,chain_id,registry_address,tx_hash,block_number,minted_at,updated_at',
    )
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`erc8004_supabase_agents_query_failed:${error.message}`);
  }

  return (data ?? []).map((row) => ({
    agentId: row.agent_id,
    tokenId: row.token_id,
    owner: row.owner,
    controller: row.controller,
    metadataURI: row.metadata_uri,
    metadata: row.metadata_json ?? null,
    source: row.source,
    chainId: row.chain_id,
    registryAddress: row.registry_address,
    txHash: row.tx_hash,
    blockNumber: row.block_number,
    mintedAt: row.minted_at,
    updatedAt: row.updated_at,
    onchain: true,
  }));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function inferCanonicalSource(agent: any): CanonicalAgentSource {
  const uri = String(agent.metadataURI || '');
  if (uri.startsWith('arclayer://manifest/')) return 'manifest';
  if (uri.includes('/api/a2a/metadata/draft/')) return 'draft';
  if (agent.skillHash || agent.reputationScore || agent.proofTokenIds) return 'indexer';
  return 'onchain';
}

function toCanonicalAgent(agent: any): CanonicalAgentLike {
  return {
    agentId: String(agent.agentId),
    controller: agent.controller || agent.owner || null,
    source: inferCanonicalSource(agent),
    metadata: agent.metadata,
    tokenURI: agent.metadataURI || null,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source') || process.env.A2A_AGENT_ROSTER_SOURCE || 'local-indexer';
  const categoryFilter = searchParams.get('category') || null;

  if (source === 'registered-only') {
    const approvedExternal = await listRegisteredExternalAgents();
    return NextResponse.json({
      registry: 'external-registry',
      agents: approvedExternal.map((agent) => {
        const identity = normalizeAgentIdentity({
          agentId: agent.agentId,
          controller: agent.address || agent.owner,
          owner: agent.owner || agent.address,
          source: agent.source || 'external-registry',
        });

        return {
          agentId: identity.agentId,
          tokenId: identity.tokenId,
          owner: identity.owner || identity.controller,
          controller: identity.controller,
          role: 'REGISTERED_EXTERNAL_AGENT',
          roleId: null,
          endpoint: agent.endpoint || '',
          metadataURI: '',
          source: identity.source,
          onchain: false,
          metadata: {
            name: agent.name,
            role: 'REGISTERED_EXTERNAL_AGENT',
            autonomous: true,
            endpoint: agent.endpoint,
            capability: agent.capabilities || [],
            skills: agent.capabilities || [],
          },
        };
      }),
      totalRegistered: approvedExternal.length,
      totalVisible: approvedExternal.length,
      totalAutonomous: approvedExternal.length,
      totalHidden: 0,
      scan: { fromBlock: null, toBlock: null, chunks: 0, maxRange: '0', source },
      categoryFilter,
      timestamp: new Date().toISOString(),
    }, { headers: { 'Cache-Control': AGENTS_CACHE_CONTROL } });
  }

  if (source === 'erc8004-supabase') {
    try {
      const canonicalAgents = await fetchCanonicalErc8004Agents();

      const agents = (
        await mapWithConcurrency(canonicalAgents, METADATA_CONCURRENCY, async (agent) => {
          const identity = normalizeAgentIdentity({
            agentId: agent.agentId,
            tokenId: agent.tokenId,
            controller: agent.controller,
            owner: agent.owner || agent.controller,
            source: agent.source || 'erc8004_identity_registry',
          });

          const resolvedMetadata =
            agent.metadata ?? await fetchMetadata(agent.metadataURI || '', agent.agentId);

          return {
            agentId: identity.agentId,
            tokenId: identity.tokenId,
            owner: identity.owner || identity.controller,
            controller: identity.controller,
            role: resolvedMetadata?.role || 'REGISTERED_AGENT',
            roleId: null,
            endpoint: resolvedMetadata?.endpoint || '',
            metadataURI: agent.metadataURI || '',
            registeredAtBlock: agent.blockNumber || null,
            source: identity.source,
            onchain: true,
            registryAddress: agent.registryAddress,
            txHash: agent.txHash,
            chainId: agent.chainId,
            mintedAt: agent.mintedAt,
            updatedAt: agent.updatedAt,
            metadata: resolvedMetadata ?? { autonomous: true },
          };
        })
      ).filter((agent) => !isHiddenAgent(agent.agentId));

      return NextResponse.json(
        {
          registry: AGENT_REGISTRY,
          sourceMode: 'erc8004-supabase',
          resolvedSource: 'erc8004-supabase',
          globalEnabled: false,
          agents,
          totalRegistered: agents.length,
          totalVisible: agents.length,
          totalAutonomous: agents.length,
          totalHidden: canonicalAgents.length - agents.length,
          categoryFilter,
          scan: { fromBlock: null, toBlock: null, chunks: 0, maxRange: '0', source },
          timestamp: new Date().toISOString(),
        },
        { headers: { 'Cache-Control': AGENTS_CACHE_CONTROL } },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'erc8004_supabase_source_failed';

      return NextResponse.json(
        {
          registry: AGENT_REGISTRY,
          sourceMode: 'erc8004-supabase',
          resolvedSource: 'erc8004-supabase',
          globalEnabled: false,
          agents: [],
          totalRegistered: 0,
          totalVisible: 0,
          totalAutonomous: 0,
          totalHidden: 0,
          categoryFilter,
          scan: { fromBlock: null, toBlock: null, chunks: 0, maxRange: '0', source },
          error: 'erc8004_supabase_source_failed',
          detail: message,
        },
        { status: 502, headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' } },
      );
    }
  }

  try {
    const storedManifests = await listStoredManifests();
    const manifestById = new Map(storedManifests.map((item) => [String(item.agentId).toLowerCase(), item]));

    // Source 1: Indexer agents (ERC-8004 on-chain data)
    const origin = new URL(request.url).origin;
    const indexerAgents = await mapWithConcurrency(
      await fetchIndexerAgents(origin),
      METADATA_CONCURRENCY,
      async (agent) => {
        const metadata = await fetchMetadata(agent.metadataURI || '', agent.agentId);
        const identity = normalizeAgentIdentity({
          agentId: agent.agentId,
          tokenId: agent.tokenId,
          controller: agent.controller,
          owner: agent.controller,
          source: agent.source || 'erc8004_identity_registry',
        });

        return {
          agentId: identity.agentId,
          tokenId: identity.tokenId,
          owner: identity.owner || identity.controller,
          controller: identity.controller,
          role: metadata?.role || 'REGISTERED_AGENT',
          roleId: null,
          endpoint: metadata?.endpoint || '',
          metadataURI: agent.metadataURI || '',
          registeredAtBlock: agent.registeredAt,
          source: identity.source,
          onchain: true,
          skillHash: agent.skillHash,
          reputationScore: agent.reputationScore,
          score: agent.score,
          jobs: agent.jobs || [],
          proofTokenIds: agent.proofTokenIds || [],
          metadata: metadata ?? { autonomous: true },
        };
      },
    );

    // Source 2: Stored manifests (web_manifest registrations)
    // Stored manifests have richer metadata (name, endpoint, categories, x402).
    // When an indexer row already exists for the same normalized ID, merge on-chain
    // fields (tokenId, onchain, skillHash, reputationScore, etc.) INTO the manifest
    // entry instead of skipping. This prevents the ExternalBotWizard flow from showing
    // fallback metadata when the manifest has the real published name/endpoint.
    const merged = new Map<string, any>();
    for (const agent of indexerAgents) merged.set(String(agent.agentId).toLowerCase(), agent);

    for (const [normalizedId, stored] of manifestById.entries()) {
      const manifest = stored.manifest;
      const identity = normalizeAgentIdentity({
        agentId: stored.agentId,
        controller: stored.controller,
        owner: stored.controller,
        source: 'web_manifest',
      });

      const existing = merged.get(normalizedId);

      const manifestEntry = {
        agentId: identity.agentId,
        tokenId: identity.tokenId,
        owner: identity.owner || identity.controller,
        controller: identity.controller,
        role: manifest.role || 'REGISTERED_AGENT',
        roleId: null,
        endpoint: manifest.endpoint || '',
        metadataURI: `arclayer://manifest/${encodeURIComponent(stored.agentId)}`,
        registeredAtBlock: null,
        source: 'web_manifest' as const,
        onchain: false,
        metadata: {
          name: manifest.name,
          role: manifest.role,
          description: manifest.description,
          capability: manifest.capability,
          categories: manifest.categories,
          autonomous: true,
          avatar: manifest.avatar,
          endpoint: manifest.endpoint,
          mode: manifest.mode,
          price: manifest.price,
          skills: manifest.capabilities,
          x402: manifest.x402?.enabled ? 'enabled' : undefined,
        },
      };

      if (existing) {
        // Merge on-chain fields into the manifest entry (manifest metadata wins)
        merged.set(normalizedId, {
          ...manifestEntry,
          tokenId: existing.tokenId || manifestEntry.tokenId,
          onchain: existing.onchain,
          registeredAtBlock: existing.registeredAtBlock,
          skillHash: existing.skillHash,
          reputationScore: existing.reputationScore,
          score: existing.score,
          jobs: existing.jobs,
          proofTokenIds: existing.proofTokenIds,
          // Preserve manifest metadataURI unless indexer has a real on-chain URI
          metadataURI: existing.metadataURI && !existing.metadataURI.startsWith('arclayer://')
            ? existing.metadataURI
            : manifestEntry.metadataURI,
        });
      } else {
        merged.set(normalizedId, manifestEntry);
      }
    }

    // Filter hidden agents
    const allAgents = Array.from(merged.values()).filter(
      (agent) => !isHiddenAgent(agent.agentId),
    );

    // Apply canonical profile filter
    const mode = getCanonicalProfileMode();

    const visibleAgents = allAgents
      .filter((agent) =>
        shouldExposeAgent({
          agent: toCanonicalAgent(agent),
          mode,
          surface: 'discovery',
        }),
      )
      .sort((a, b) =>
        platformSortRank(toCanonicalAgent(a)) - platformSortRank(toCanonicalAgent(b)),
      )
      .map((agent) => ({
        ...agent,
        badge: getAgentBadge(toCanonicalAgent(agent)),
      }));

    return NextResponse.json({
      registry: AGENT_REGISTRY,
      agents: visibleAgents,
      totalRegistered: allAgents.length,
      totalHidden: allAgents.length - visibleAgents.length,
      totalVisible: visibleAgents.length,
      totalAutonomous: visibleAgents.length,
      canonicalMode: mode,
      categoryFilter,
      scan: { fromBlock: null, toBlock: null, chunks: 0, maxRange: '0', source },
      timestamp: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': AGENTS_CACHE_CONTROL },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'registry_sync_failed';

    return NextResponse.json(
      {
        registry: AGENT_REGISTRY,
        agents: [],
        totalRegistered: 0,
        totalAutonomous: 0,
        scan: { fromBlock: null, toBlock: null, chunks: 0, maxRange: '0', source },
        error: 'registry_sync_failed',
        detail: message,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' } },
    );
  }
}
