import { NextResponse } from 'next/server';
import {
  createPublicClient,
  http,
  parseAbiItem,
  recoverMessageAddress,
  type Hex,
} from 'viem';
import {
  parseManifest,
  upsertManifest,
  buildManifestMessage,
  manifestHash,
} from '@/lib/a2a/manifest';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const AGENT_REGISTRY = '0xB263336055dD65FF501e36CA39941760D943703C' as Hex;
const FROM_BLOCK = BigInt(process.env.AGENT_REGISTRY_FROM_BLOCK || '0');
const MAX_TIMESTAMP_SKEW_SEC = 5 * 60; // ±5min

const AGENT_REGISTERED = parseAbiItem(
  'event AgentRegistered(uint256 indexed agentId, bytes32 indexed skillHash, address indexed controller, string metadataURI)'
);

/**
 * Look up the on-chain controller for an agentId by scanning AgentRegistered logs.
 * Returns null if the agent has never registered (TOFU window).
 */
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
    // Latest registration wins (controller could update via re-register).
    const latest = logs.sort((a, b) => Number(b.blockNumber ?? BigInt(0)) - Number(a.blockNumber ?? BigInt(0)))[0];
    return latest.args.controller?.toLowerCase() ?? null;
  } catch (err) {
    console.error('[manifest.api] controller lookup failed', err);
    return null;
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }

  const { manifest: rawManifest, signature, ts } = body as {
    manifest?: unknown;
    signature?: unknown;
    ts?: unknown;
  };

  if (typeof signature !== 'string' || !/^0x[a-fA-F0-9]+$/.test(signature)) {
    return NextResponse.json({ error: 'signature must be a 0x-prefixed hex string' }, { status: 400 });
  }
  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    return NextResponse.json({ error: 'ts must be a unix-seconds number' }, { status: 400 });
  }

  // Anti-replay: reject stale or future-dated signatures
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_SKEW_SEC) {
    return NextResponse.json({ error: 'signature timestamp out of bounds' }, { status: 400 });
  }

  // Parse + validate manifest
  const parsed = parseManifest(rawManifest);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const manifest = parsed.manifest;

  // Recompute hash from the SERVER-side canonical serialization — never trust client hash
  const hash = manifestHash(manifest);
  const message = buildManifestMessage({ agentId: manifest.agentId, manifestHash: hash, ts });

  let signer: string;
  try {
    signer = (await recoverMessageAddress({ message, signature: signature as `0x${string}` })).toLowerCase();
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  // On-chain controller binding
  const onchainController = await getOnchainController(manifest.agentId);

  if (onchainController) {
    // Registered agent — signer MUST match on-chain controller.
    if (signer !== onchainController) {
      return NextResponse.json(
        { error: 'signer is not the on-chain controller for this agent' },
        { status: 403 }
      );
    }
  }
  // else: TOFU — agent not yet registered. First writer claims pending manifest;
  // when the agent is later registered on-chain, the controller is verified at READ time.

  const result = await upsertManifest({
    agentId: manifest.agentId,
    controller: onchainController ?? signer,
    manifest,
    manifestHash: hash,
    signature,
    signer,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    agentId: manifest.agentId,
    manifestHash: hash,
    controller: onchainController ?? signer,
    tofu: !onchainController,
  });
}
