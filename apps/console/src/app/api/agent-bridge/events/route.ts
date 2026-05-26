import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { insertBridgeEvent, listBridgeEvents, stablePayloadHash, type BridgeEventInput } from '@/lib/agent-bridge/store';
import { requireRegisteredExternalAgent } from '@/lib/a2a/external-registry';
import { bridgeRail } from '@/lib/rails/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES = new Set(['session_started', 'bridge_event', 'work_proof', 'receipt_reference', 'market_snapshot', 'resolver_output', 'evaluation', 'execution_intent']);
const ADMIN_SCOPES = new Set(['admin', 'agent_bridge:admin']);

function isValidRole(role: string) {
  return /^[a-z][a-z0-9_-]{1,63}$/.test(role);
}

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, ...bridgeRail(), error, ...(extra ?? {}) }, { status });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req, API_KEY_SCOPES.AGENT_BRIDGE_WRITE);
  if (auth.error) return auth.error;

  let body: Partial<BridgeEventInput>;
  try {
    body = await req.json();
  } catch {
    return bad('invalid_json');
  }

  const sessionId = String(body.sessionId ?? '').trim();
  const agentId = String(body.agentId ?? auth.key.agentId).trim();
  const role = String(body.role ?? '');
  const type = String(body.type ?? '');

  if (!sessionId) return bad('missing_sessionId');
  if (!agentId) return bad('missing_agentId');
  if (!(await requireRegisteredExternalAgent(agentId))) {
    console.warn(`[a2a] rejected unregistered external agent agentId=${agentId}`);
    return bad('unregistered_external_agent', 403);
  }
  if (!isValidRole(role)) return bad('invalid_role');
  if (!TYPES.has(type)) return bad('invalid_type');
  if (body.payload === null || typeof body.payload !== 'object' || Array.isArray(body.payload)) return bad('invalid_payload');
  // P0.7: Server-compute canonical hash and reject client-provided mismatch
  const serverHash = stablePayloadHash(body.payload);
  const clientHash = typeof body.payloadHash === 'string' ? body.payloadHash.trim() : '';
  if (clientHash && clientHash !== serverHash) {
    return NextResponse.json(
      {
        ok: false,
        rail: 'bridge',
        settlementMode: 'x402_offchain',
        error: 'payload_hash_mismatch',
        expectedPayloadHash: serverHash,
        receivedPayloadHash: clientHash,
      },
      { status: 400 },
    );
  }

  const hasAdminScope = auth.key.scopes.some((scope) => ADMIN_SCOPES.has(scope));
  if (agentId !== auth.key.agentId && !hasAdminScope) return bad('agent_id_mismatch', 403);

  try {
    const event = await insertBridgeEvent({
      sessionId,
      runtimeId: typeof body.runtimeId === 'string' ? body.runtimeId.trim() : null,
      agentId,
      role: role as BridgeEventInput['role'],
      type: type as BridgeEventInput['type'],
      payload: body.payload as Record<string, unknown>,
      payloadHash: serverHash,
      metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata as Record<string, unknown> : {},
      source: typeof body.source === 'string' ? body.source : 'external-runtime',
      dryRun: body.dryRun !== false,
      jobId: typeof body.jobId === 'string' ? body.jobId.trim() : null,
      category: typeof body.category === 'string' ? body.category.trim() : null,
    });
    return NextResponse.json({ ok: true, ...bridgeRail(), eventId: event.id, deduped: event.deduped });
  } catch (err) {
    return bad('insert_failed', 500, { message: err instanceof Error ? err.message : 'unknown' });
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req, [API_KEY_SCOPES.AGENT_BRIDGE_WRITE, API_KEY_SCOPES.AGENT_BRIDGE_RECEIPT]);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const requestedLimit = Number(searchParams.get('limit') ?? '50');
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 100);
  const sessionId = searchParams.get('sessionId');
  const role = searchParams.get('role');
  const agentId = searchParams.get('agentId');
  const runtimeId = searchParams.get('runtimeId');
  const jobId = searchParams.get('jobId');
  const category = searchParams.get('category');

  try {
    const events = await listBridgeEvents({
      sessionId,
      role,
      agentId,
      runtimeId,
      jobId,
      category,
      limit,
    });
    return NextResponse.json({ ok: true, ...bridgeRail(), events });
  } catch (err) {
    return bad('query_failed', 500, { message: err instanceof Error ? err.message : 'unknown' });
  }
}
