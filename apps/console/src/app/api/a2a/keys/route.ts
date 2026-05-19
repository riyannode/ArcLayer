import { NextRequest, NextResponse } from 'next/server';
import { recoverMessageAddress } from 'viem';
import { createApiKey, revokeApiKey } from '@/lib/a2a/auth';
import { getManifest } from '@/lib/a2a/manifest';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_TIMESTAMP_SKEW_SEC = 5 * 60;

function keyMessage(input: { agentId: string; action: 'create' | 'revoke'; ts: number; keyId?: string }): string {
  return [
    'ArcLayer A2A API Key',
    `action: ${input.action}`,
    `agentId: ${input.agentId}`,
    input.keyId ? `keyId: ${input.keyId}` : undefined,
    `ts: ${input.ts}`,
  ].filter(Boolean).join('\n');
}

async function verifyControllerSignature(input: {
  agentId: string;
  action: 'create' | 'revoke';
  ts: unknown;
  signature: unknown;
  keyId?: string;
}): Promise<{ ok: true; signer: string } | { ok: false; response: NextResponse }> {
  if (typeof input.ts !== 'number' || !Number.isFinite(input.ts)) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'ts must be unix seconds' }, { status: 400 }) };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.ts) > MAX_TIMESTAMP_SKEW_SEC) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'signature timestamp out of bounds' }, { status: 400 }) };
  }

  if (typeof input.signature !== 'string' || !/^0x[a-fA-F0-9]+$/.test(input.signature)) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'signature must be 0x hex' }, { status: 400 }) };
  }

  const stored = await getManifest(input.agentId);
  if (!stored?.controller) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'agent_manifest_not_found' }, { status: 404 }) };
  }

  const message = keyMessage({
    agentId: input.agentId,
    action: input.action,
    ts: input.ts,
    keyId: input.keyId,
  });

  let signer: string;
  try {
    signer = (await recoverMessageAddress({ message, signature: input.signature as `0x${string}` })).toLowerCase();
  } catch {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 400 }) };
  }

  if (signer !== stored.controller.toLowerCase()) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'signer_not_controller' }, { status: 403 }) };
  }

  return { ok: true, signer };
}

/**
 * POST /api/a2a/keys
 * Body: { agentId, label?, scopes?, ts, signature }
 * Signature message:
 *   ArcLayer A2A API Key\n...
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    agentId?: unknown;
    label?: unknown;
    scopes?: unknown;
    ts?: unknown;
    signature?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (typeof body.agentId !== 'string' || body.agentId.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'agentId is required' }, { status: 400 });
  }
  const agentId = body.agentId.trim();

  const auth = await verifyControllerSignature({
    agentId,
    action: 'create',
    ts: body.ts,
    signature: body.signature,
  });
  if (!auth.ok) return auth.response;

  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((s): s is string => typeof s === 'string')
    : undefined;

  const result = await createApiKey({
    agentId,
    label: typeof body.label === 'string' ? body.label : undefined,
    scopes,
    createdBy: auth.signer,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    agentId,
    key: result.key, // shown once; DB stores hash only
    keyPrefix: result.keyPrefix,
    id: result.id,
  });
}

/**
 * DELETE /api/a2a/keys
 * Body: { agentId, keyId, ts, signature }
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  let body: {
    agentId?: unknown;
    keyId?: unknown;
    ts?: unknown;
    signature?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (typeof body.agentId !== 'string' || typeof body.keyId !== 'string') {
    return NextResponse.json({ ok: false, error: 'agentId and keyId are required' }, { status: 400 });
  }

  const agentId = body.agentId.trim();
  const keyId = body.keyId.trim();
  const auth = await verifyControllerSignature({
    agentId,
    action: 'revoke',
    keyId,
    ts: body.ts,
    signature: body.signature,
  });
  if (!auth.ok) return auth.response;

  const ok = await revokeApiKey(keyId, agentId);
  if (!ok) return NextResponse.json({ ok: false, error: 'revoke_failed' }, { status: 500 });

  return NextResponse.json({ ok: true, agentId, keyId, revoked: true });
}
