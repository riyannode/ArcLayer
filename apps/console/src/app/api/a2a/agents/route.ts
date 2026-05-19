import { NextResponse } from 'next/server';
import { createPublicClient, http, parseAbiItem, type Hex, type Log } from 'viem';
import { isHiddenAgent } from '@/lib/a2a/hidden-agents';
import { resolveManifestMetadata } from '@/lib/a2a/manifest';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const AGENT_REGISTRY = '0xB263336055dD65FF501e36CA39941760D943703C' as Hex;

// A2A deploy block on Arc testnet (5042002): 42_548_683.
// Default to that so we don't scan from genesis (blocked by free-tier RPC range cap).
const DEFAULT_FROM_BLOCK = BigInt(42548683);
const FROM_BLOCK = BigInt(process.env.AGENT_REGISTRY_FROM_BLOCK || DEFAULT_FROM_BLOCK.toString());

// drpc.testnet.arc.network free tier rejects ranges > 10_000 blocks.
const MAX_BLOCK_RANGE = BigInt(process.env.AGENT_REGISTRY_MAX_RANGE || '9000');
const MAX_METADATA_BYTES = 32_000;
const METADATA_CONCURRENCY = 6;

const AGENT_REGISTERED = parseAbiItem(
  'event AgentRegistered(bytes32 indexed agentId, address indexed owner, uint8 indexed role, string endpoint, string metadataURI)'
);

const ROLE_NAMES: Record<number, string> = {
  0: 'MARKET_DATA',
  1: 'TRADER',
  2: 'EXECUTOR',
  3: 'ORACLE',
  4: 'AGGREGATOR',
};

type AgentMetadata = {
  name?: string;
  role?: string;
  description?: string;
  capability?: string[];
  categories?: string[];
  autonomous?: boolean;
  avatar?: string;
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
    };
  }

  if (!uri || !isSafeHttpUri(uri)) return null;
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
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type RegisteredLog = Log<bigint, number, false, typeof AGENT_REGISTERED, true>;

async function fetchLogsChunked(
  client: ReturnType<typeof createPublicClient>,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<{ logs: RegisteredLog[]; chunks: number }> {
  const logs: RegisteredLog[] = [];
  let chunks = 0;
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = cursor + MAX_BLOCK_RANGE - BigInt(1) > toBlock ? toBlock : cursor + MAX_BLOCK_RANGE - BigInt(1);
    const chunkLogs = await client.getLogs({
      address: AGENT_REGISTRY,
      event: AGENT_REGISTERED,
      fromBlock: cursor,
      toBlock: end,
    });
    logs.push(...(chunkLogs as RegisteredLog[]));
    chunks += 1;
    cursor = end + BigInt(1);
  }
  return { logs, chunks };
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const categoryFilter = searchParams.get('category') || null;
  const client = createPublicClient({ transport: http(RPC) });

  try {
    const latestBlock = await client.getBlockNumber();
    const fromBlock = FROM_BLOCK > latestBlock ? latestBlock : FROM_BLOCK;
    const { logs, chunks } = await fetchLogsChunked(client, fromBlock, latestBlock);

    const latestById = new Map<string, RegisteredLog>();
    for (const log of logs) {
      const agentId = log.args.agentId?.toString();
      if (agentId) latestById.set(agentId, log);
    }

    const visibleLogs = Array.from(latestById.values()).filter((log) => {
      const agentId = log.args.agentId?.toString() || '';
      return agentId && !isHiddenAgent(agentId);
    });

    const agents = await mapWithConcurrency(visibleLogs, METADATA_CONCURRENCY, async (log) => {
      const metadataURI = log.args.metadataURI || '';
      const agentId = log.args.agentId?.toString() || '';
      const roleNum = typeof log.args.role === 'number' ? log.args.role : Number(log.args.role ?? 0);
      const roleName = ROLE_NAMES[roleNum] ?? `ROLE_${roleNum}`;
      const metadata = await fetchMetadata(metadataURI, agentId);
      // A2A registry only has autonomous role types; if metadata fails to resolve,
      // fall back to on-chain role as the source of truth.
      const enrichedMetadata = metadata ?? {
        name: undefined,
        role: roleName,
        autonomous: true,
      };
      return {
        agentId,
        owner: log.args.owner || '',
        role: roleName,
        roleId: roleNum,
        endpoint: log.args.endpoint || '',
        metadataURI,
        registeredAtBlock: log.blockNumber?.toString(),
        metadata: enrichedMetadata,
      };
    });

    // All A2A registry agents are autonomous by contract design.
    // Older filter-by-metadata.autonomous was for AgentRegistry v1 (free-form metadata).
    const autonomousAgents = agents;

    return NextResponse.json({
      registry: AGENT_REGISTRY,
      agents: autonomousAgents,
      totalRegistered: latestById.size,
      totalHidden: latestById.size - visibleLogs.length,
      totalVisible: visibleLogs.length,
      totalAutonomous: autonomousAgents.length,
      categoryFilter,
      scan: {
        fromBlock: fromBlock.toString(),
        toBlock: latestBlock.toString(),
        chunks,
        maxRange: MAX_BLOCK_RANGE.toString(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'registry_sync_failed';
    return NextResponse.json(
      {
        registry: AGENT_REGISTRY,
        agents: [],
        totalRegistered: 0,
        totalAutonomous: 0,
        scan: {
          fromBlock: FROM_BLOCK.toString(),
          toBlock: null,
          chunks: 0,
          maxRange: MAX_BLOCK_RANGE.toString(),
        },
        error: message,
      },
      { status: 200 },
    );
  }
}
