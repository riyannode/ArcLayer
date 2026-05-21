import { NextRequest, NextResponse } from 'next/server';
import {
  recoverMessageAddress,
} from 'viem';
import { getERC8004OwnerOf } from '@/lib/contracts/erc8004';
import {
  parseManifest,
  upsertManifest,
  buildManifestMessage,
  manifestHash,
  getManifest,
} from '@/lib/a2a/manifest';
import { withX402 } from '@/lib/x402';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_TIMESTAMP_SKEW_SEC = 5 * 60; // ±5min

export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agentId')?.trim();
  if (!agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }
  const record = await getManifest(agentId);
  if (!record) {
    return NextResponse.json({ error: 'manifest not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, manifest: record.manifest, controller: record.controller });
}

/**
 * Official ERC-8004 identity controller lookup.
 * The canonical agentId is the ERC-721 tokenId minted by register(metadataURI),
 * so controller ownership must come from ownerOf(agentId), not legacy AgentRegistered logs.
 * Returns null when the token is not minted yet (TOFU/pending manifest window).
 */
async function getOnchainController(agentId: string): Promise<string | null> {
  try {
    return (await getERC8004OwnerOf(agentId)).toLowerCase();
  } catch (err) {
    console.warn('[manifest.api] ERC-8004 ownerOf lookup returned no controller', err);
    return null;
  }
}

async function postHandler(req: NextRequest): Promise<NextResponse> {
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

// 0.000001 USDC = 1 atomic (6 decimals). GET remains free; publishing/updating a manifest is paid anti-spam.
export const POST = withX402(postHandler, {
  amount: '1',
  resource: '/api/a2a/manifest',
  description: 'Publish or update an A2A agent manifest — anti-spam fee',
});
