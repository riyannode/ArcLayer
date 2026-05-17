import { NextResponse } from 'next/server';
import { createPublicClient, http, parseAbiItem, type Hex } from 'viem';
import { getManifest } from '@/lib/a2a/manifest';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const AGENT_REGISTRY = '0xB263336055dD65FF501e36CA39941760D943703C' as Hex;
const FROM_BLOCK = BigInt(process.env.AGENT_REGISTRY_FROM_BLOCK || '0');

const AGENT_REGISTERED = parseAbiItem(
  'event AgentRegistered(uint256 indexed agentId, bytes32 indexed skillHash, address indexed controller, string metadataURI)'
);

async function getOnchainController(agentId: string): Promise<string | null> {
  try {
    const client = createPublicClient({ transport: http(RPC) });
    const idBig = BigInt(agentId);
    const logs = await client.getLogs({
      address: AGENT_REGISTRY,
      event: AGENT_REGISTERED,
      args: { agentId: idBig },
      fromBlock: FROM_BLOCK,
      toBlock: 'latest',
    });
    if (logs.length === 0) return null;
    const latest = logs.sort((a, b) => Number(b.blockNumber ?? BigInt(0)) - Number(a.blockNumber ?? BigInt(0)))[0];
    return latest.args.controller?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: { agentId: string } }) {
  const agentId = params.agentId;
  if (!agentId || !/^[0-9]+$/.test(agentId)) {
    return NextResponse.json({ error: 'invalid agentId' }, { status: 400 });
  }

  const stored = await getManifest(agentId);
  if (!stored) {
    return NextResponse.json({ error: 'manifest not found' }, { status: 404 });
  }

  // Cross-verify against on-chain controller — drop stale TOFU rows where
  // the on-chain controller now disagrees with the stored signer.
  const onchainController = await getOnchainController(agentId);
  if (onchainController && stored.signer && stored.signer !== onchainController) {
    return NextResponse.json(
      { error: 'manifest controller mismatch with on-chain registration' },
      { status: 410 }
    );
  }

  return NextResponse.json({
    agentId: stored.agentId,
    manifest: stored.manifest,
    manifestHash: stored.manifestHash,
    controller: onchainController ?? stored.controller,
    signer: stored.signer,
    updatedAt: stored.updatedAt,
    tofu: !onchainController,
  });
}
