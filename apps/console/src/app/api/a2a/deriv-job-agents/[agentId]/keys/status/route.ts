import { NextRequest, NextResponse } from 'next/server';
import {
  verifyDerivJobKeyOwnerRequest,
  listDerivA2aKeyPrefixes,
} from '@/lib/a2a/deriv-job-key-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/a2a/deriv-job-agents/[agentId]/keys/status
 *
 * Returns active (non-revoked) keys for a Deriv agent.
 * Never returns raw keys or key_hash — only keyPrefix, label, scopes, createdAt.
 *
 * Body:
 *   { ownerAddress, signature, timestamp, role?, jobType? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId: rawAgentId } = await params;
  const agentId = decodeURIComponent(rawAgentId || '').trim();

  if (!agentId) {
    return NextResponse.json({ ok: false, error: 'missing_agent_id' }, {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, {
      status: 400,
      headers: { 'cache-control': 'no-store' },
    });
  }

  // Verify wallet ownership (signature not strictly needed for read, but
  // we verify to prevent unauthorized enumeration of active keys)
  const auth = await verifyDerivJobKeyOwnerRequest({
    agentId,
    ownerAddress: String(body.ownerAddress ?? ''),
    signature: String(body.signature ?? ''),
    timestamp: Number(body.timestamp),
    role: String(body.role ?? 'deriv-worker'),
  });

  if (!auth.ok) return auth.response;

  // List active keys
  const keys = await listDerivA2aKeyPrefixes(agentId);

  return NextResponse.json(
    {
      ok: true,
      agent: {
        agentId: auth.agent.agentId,
        name: auth.agent.name ?? null,
        status: auth.agent.status,
      },
      keys,
      policy: {
        role: auth.policy.role,
        label: auth.policy.label,
        scopes: auth.policy.scopes,
      },
    },
    {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
