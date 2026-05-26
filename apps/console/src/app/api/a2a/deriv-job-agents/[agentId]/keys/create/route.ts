import { NextRequest, NextResponse } from 'next/server';
import {
  verifyDerivJobKeyOwnerRequest,
  createDerivA2aKey,
  buildDerivJobEnv,
} from '@/lib/a2a/deriv-job-key-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/a2a/deriv-job-agents/[agentId]/keys/create
 *
 * Create a replacement key WITHOUT revoking old keys.
 * Use this when user forgot the key but old bot may still be running.
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

  // Verify wallet ownership + agent status
  const auth = await verifyDerivJobKeyOwnerRequest({
    agentId,
    ownerAddress: String(body.ownerAddress ?? ''),
    signature: String(body.signature ?? ''),
    timestamp: Number(body.timestamp),
    role,
    action: 'create_deriv_a2a_job_key',
  });

  if (!auth.ok) return auth.response;

  // Create new key (old keys remain active — this is replacement, not rotate)
  const result = await createDerivA2aKey({
    agentId,
    role: auth.role,
    policy: auth.policy,
    ownerAddress: auth.ownerAddress,
  });

  if (!result.ok) {
    console.error('[deriv-job] create key failed', result.error);
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
    mode: 'replacement',
    warning: 'raw_key_is_shown_once_store_it_now',
    hint: 'Old keys are still active. Use Rotate Now if this key leaked.',
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
