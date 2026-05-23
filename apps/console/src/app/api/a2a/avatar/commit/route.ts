import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import { getERC8004OwnerOf } from '@/lib/contracts/erc8004';
import { buildManifestMessage, manifestHash, parseManifest, upsertManifest } from '@/lib/a2a/manifest';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_TIMESTAMP_SKEW_SEC = 5 * 60;

type AvatarCommitTokenPayload = {
  agentId: string;
  url: string;
  exp: number;
};

function verifyAvatarCommitToken(token: string): { ok: true; payload: AvatarCommitTokenPayload } | { ok: false } {
  const secret = process.env.AVATAR_COMMIT_SECRET;
  if (!secret) return { ok: false };

  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false };
  const [payloadBase64Url, signature] = parts;

  const expected = createHmac('sha256', secret).update(payloadBase64Url).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false };
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64Url, 'base64url').toString('utf8')) as AvatarCommitTokenPayload;
    if (
      !payload ||
      typeof payload.agentId !== 'string' ||
      typeof payload.url !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return { ok: false };
    }
    if (Math.floor(Date.now() / 1000) > payload.exp) return { ok: false };
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}

async function getOnchainController(agentId: string): Promise<string | null> {
  try {
    return (await getERC8004OwnerOf(agentId)).toLowerCase();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }

  const { manifest: rawManifest, signature, ts, avatarCommitToken } = body as {
    manifest?: unknown;
    signature?: unknown;
    ts?: unknown;
    avatarCommitToken?: unknown;
  };

  if (typeof avatarCommitToken !== 'string') {
    return NextResponse.json({ error: 'invalid avatar commit token' }, { status: 401 });
  }
  const verifiedToken = verifyAvatarCommitToken(avatarCommitToken);
  if (!verifiedToken.ok) {
    return NextResponse.json({ error: 'invalid avatar commit token' }, { status: 403 });
  }

  if (typeof signature !== 'string' || !/^0x[a-fA-F0-9]+$/.test(signature)) {
    return NextResponse.json({ error: 'signature must be a 0x-prefixed hex string' }, { status: 400 });
  }
  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    return NextResponse.json({ error: 'ts must be a unix-seconds number' }, { status: 400 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_SKEW_SEC) {
    return NextResponse.json({ error: 'signature timestamp out of bounds' }, { status: 400 });
  }

  const parsed = parseManifest(rawManifest);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const manifest = parsed.manifest;

  if (verifiedToken.payload.agentId !== manifest.agentId || manifest.avatar !== verifiedToken.payload.url) {
    return NextResponse.json({ error: 'avatar commit token does not match manifest' }, { status: 403 });
  }

  const hash = manifestHash(manifest);
  const message = buildManifestMessage({ agentId: manifest.agentId, manifestHash: hash, ts });
  let signer: string;
  try {
    signer = (await recoverMessageAddress({ message, signature: signature as `0x${string}` })).toLowerCase();
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  const controller = await getOnchainController(manifest.agentId);
  if (!controller || signer !== controller) {
    return NextResponse.json({ error: 'signer is not the on-chain controller for this agent' }, { status: 403 });
  }

  const result = await upsertManifest({
    agentId: manifest.agentId,
    controller,
    manifest,
    manifestHash: hash,
    signature,
    signer,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, agentId: manifest.agentId, manifestHash: hash, controller });
}
