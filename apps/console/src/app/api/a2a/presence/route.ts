import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listAgentPresenceByCategory, upsertAgentPresence } from '@/lib/a2a/live-events';
import { requireApiKey } from '@/lib/a2a/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function checkGlobalToken(request: Request): boolean {
  const required = process.env.A2A_LIVE_EVENTS_TOKEN?.trim();
  if (!required) return process.env.NODE_ENV !== 'production';

  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const header = request.headers.get('x-arclayer-live-token')?.trim() ?? null;

  return bearer === required || header === required;
}

/** Reject body if it contains obvious secret field names at top level. */
const SECRET_FIELD_RE = /^(privateKey|PRIVATE_KEY|apiKey|API_KEY|secret|token)$/i;

function hasSecretFields(body: Record<string, unknown>): boolean {
  for (const key of Object.keys(body)) {
    if (SECRET_FIELD_RE.test(key)) return true;
  }
  return false;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category')?.trim() || 'prediction-market-bots';

  try {
    const presence = await listAgentPresenceByCategory(category);

    return NextResponse.json({
      ok: true,
      source: process.env.A2A_AGENT_ROSTER_SOURCE || 'local-indexer',
      category,
      total: presence.length,
      presence,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      source: 'local-indexer',
      category,
      total: 0,
      presence: [],
      error: 'local_indexer_unavailable',
      timestamp: new Date().toISOString(),
    });
  }
}

export async function POST(request: NextRequest) {
  // Read body once
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Reject obvious secret fields
  if (hasSecretFields(body)) {
    return NextResponse.json({ ok: false, error: 'secret_fields_rejected' }, { status: 400 });
  }

  // Dual auth: global A2A_LIVE_EVENTS_TOKEN OR per-agent ARCLAYER_API_KEY
  if (checkGlobalToken(request)) {
    // Global token passes — proceed with write (backward compat)
    const result = await upsertAgentPresence({
      agentId: body.agentId,
      agentName: body.agentName,
      status: body.status,
      lastEventType: body.lastEventType ?? 'heartbeat',
      lastEventSummary: body.lastEventSummary ?? 'heartbeat',
      role: body.role ?? undefined,
      runtimeType: body.runtimeType ?? undefined,
      processName: body.processName ?? undefined,
      version: body.version ?? undefined,
      chainId: body.chainId ?? undefined,
      rpcOk: body.rpcOk ?? undefined,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  }

  // Try per-agent API key auth with presence:write scope
  const auth = await requireApiKey(request, ['presence:write']);
  if (auth.error) return auth.error;

  // Enforce key.agentId === body.agentId
  if (auth.key.agentId !== body.agentId) {
    return NextResponse.json(
      { ok: false, error: 'agent_id_mismatch', key_agent: auth.key.agentId, body_agent: body.agentId },
      { status: 403 },
    );
  }

  const result = await upsertAgentPresence({
    agentId: body.agentId,
    agentName: body.agentName,
    status: body.status,
    lastEventType: body.lastEventType ?? 'heartbeat',
    lastEventSummary: body.lastEventSummary ?? 'heartbeat',
    role: body.role ?? undefined,
    runtimeType: body.runtimeType ?? undefined,
    processName: body.processName ?? undefined,
    version: body.version ?? undefined,
    chainId: body.chainId ?? undefined,
    rpcOk: body.rpcOk ?? undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
