import { NextRequest, NextResponse } from 'next/server';
import {
  verifyDerivJobKeyOwnerRequest,
  revokeDerivA2aKeyById,
} from '@/lib/a2a/deriv-job-key-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/a2a/deriv-job-agents/[agentId]/keys/revoke
 *
 * Revoke a specific key by its DB id.
 * Use when user wants to disable one particular key without replacing it.
 *
 * Body:
 *   { ownerAddress, signature, timestamp, keyId }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId: rawAgentId } = await params;
  const agentId = decodeURIComponent(rawAgentId || '').trim();

  if (!agentId) {
    return json(400, { ok: false, error: 'missing_agent_id' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const keyId = String(body.keyId ?? '').trim();
  if (!keyId) {
    return json(400, { ok: false, error: 'missing_key_id' });
  }

  // Verify wallet ownership (action = revoke)
  const auth = await verifyDerivJobKeyOwnerRequest({
    agentId,
    ownerAddress: String(body.ownerAddress ?? ''),
    signature: String(body.signature ?? ''),
    timestamp: Number(body.timestamp),
    role: String(body.role ?? 'deriv-worker'),
    action: 'revoke_deriv_a2a_job_key',
  });

  if (!auth.ok) return auth.response;

  // Revoke the specific key
  const revoked = await revokeDerivA2aKeyById(keyId, agentId);

  if (!revoked) {
    return json(404, { ok: false, error: 'key_not_found_or_already_revoked' });
  }

  return json(200, {
    ok: true,
    keyId,
    agentId,
    revoked: true,
  });
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
