import { NextResponse } from 'next/server';
import { createPublicClient, http, parseAbiItem, type Hex } from 'viem';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const AGENT_REGISTRY = '0xB263336055dD65FF501e36CA39941760D943703C' as Hex;
const FROM_BLOCK = BigInt(process.env.AGENT_REGISTRY_FROM_BLOCK || '0');
const MAX_METADATA_BYTES = 32_000;

const AGENT_REGISTERED = parseAbiItem(
  'event AgentRegistered(uint256 indexed agentId, bytes32 indexed skillHash, address indexed controller, string metadataURI)'
);

type AgentMetadata = {
  name?: string;
  role?: string;
  description?: string;
  capability?: string[];
  categories?: string[];
  autonomous?: boolean;
};

function ipfsToGateway(uri: string) {
  if (!uri.startsWith('ipfs://')) return uri;
  return `https://ipfs.io/ipfs/${uri.slice('ipfs://'.length)}`;
}

function isSafeHttpUri(uri: string) {
  try {
    const url = new URL(ipfsToGateway(uri));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

async function fetchMetadata(uri: string): Promise<AgentMetadata | null> {
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

export async function GET() {
  try {
    const client = createPublicClient({ transport: http(RPC) });
    const logs = await client.getLogs({
      address: AGENT_REGISTRY,
      event: AGENT_REGISTERED,
      fromBlock: FROM_BLOCK,
      toBlock: 'latest',
    });

    const latestById = new Map<string, (typeof logs)[number]>();
    for (const log of logs) {
      const agentId = log.args.agentId?.toString();
      if (agentId) latestById.set(agentId, log);
    }

    const agents = await Promise.all(
      Array.from(latestById.values()).map(async (log) => {
        const metadataURI = log.args.metadataURI || '';
        const metadata = await fetchMetadata(metadataURI);
        return {
          agentId: log.args.agentId?.toString() || '',
          skillHash: log.args.skillHash || '',
          controller: log.args.controller || '',
          metadataURI,
          registeredAtBlock: log.blockNumber?.toString(),
          metadata,
        };
      })
    );

    const autonomousAgents = agents.filter((agent) => agent.metadata?.autonomous === true);

    return NextResponse.json({
      registry: AGENT_REGISTRY,
      agents: autonomousAgents,
      totalRegistered: agents.length,
      totalAutonomous: autonomousAgents.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { registry: AGENT_REGISTRY, agents: [], totalRegistered: 0, totalAutonomous: 0, error: err?.message || 'registry_sync_failed' },
      { status: 200 }
    );
  }
}
