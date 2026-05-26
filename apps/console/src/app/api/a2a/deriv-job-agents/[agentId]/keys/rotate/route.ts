import { NextRequest, NextResponse } from 'next/server';
import {
  verifyDerivJobKeyOwnerRequest,
  revokeActiveDerivA2aKeys,
  createDerivA2aKey,
  buildDerivJobEnv,
} from '@/lib/a2a/deriv-job-key-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/a2a/deriv-job-agents/[agentId]/keys/rotate
 *
 * Revoke ALL active keys and create a new one.
 * Use when key leaked or immediate reset needed.
 *
 * Body:
 *   { ownerAddress, signature, timestamp, role, jobType? }
 *
 * Response includes raw key (shown once) + .env block.
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

  const role = String(body.role ?? 'deriv-worker').trim().toLowerCase();
  const jobType = String(body.jobType ?? 'deriv_signal_analysis').trim();

  // Verify wallet ownership + agent status (sign with rotate action)
  const auth = await verifyDerivJobKeyOwnerRequest({
    agentId,
    ownerAddress: String(body.ownerAddress ?? ''),
    signature: String(body.signature ?? ''),
    timestamp: Number(body.timestamp),
    role,
    requestId: String(body.requestId ?? ''),
    action: 'rotate_deriv_a2a_job_key',
  });

  if (!auth.ok) return auth.response;

  // Revoke all active keys first
  const revoked = await revokeActiveDerivA2aKeys(agentId);
  if (!revoked) {
    console.error('[deriv-job] rotate revoke failed for', agentId);
    return json(500, { ok: false, error: 'revoke_failed' });
  }

  // Create new key
  const result = await createDerivA2aKey({
    agentId,
    role: auth.role,
    policy: auth.policy,
    ownerAddress: auth.ownerAddress,
  });

  if (!result.ok) {
    console.error('[deriv-job] rotate create key failed', result.error);
    return json(500, { ok: false, error: 'create_key_failed' });
  }

  const env = buildDerivJobEnv({
    agentId,
    rawKey: result.key,
    role,
    jobType,
  });

  return json(200, {
    ok: true,
    mode: 'rotated',
    warning: 'old_keys_revoked_raw_key_shown_once_store_it_now',
    hint: 'All previous keys for this agent are now revoked.',
    key: result.key,
    env,
    keyMeta: {
      id: result.id,
      agentId,
      keyPrefix: result.keyPrefix,
      scopes: auth.policy.scopes,
      role,
      createdAt: new Date().toISOString(),
    },
  });
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
