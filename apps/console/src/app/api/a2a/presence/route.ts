import { NextResponse } from 'next/server';
import { listAgentPresenceByCategory, upsertAgentPresence } from '@/lib/a2a/live-events';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requireWriteAuth(request: Request): NextResponse | null {
  const required = process.env.A2A_LIVE_EVENTS_TOKEN?.trim();

  if (!required && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'live_events_token_not_configured' }, { status: 500 });
  }

  if (!required) return null;

  const auth = request.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const header = request.headers.get('x-arclayer-live-token')?.trim() ?? null;

  if (bearer !== required && header !== required) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  return null;
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

export async function POST(request: Request) {
  const authError = requireWriteAuth(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const result = await upsertAgentPresence({
    agentId: body.agentId,
    agentName: body.agentName,
    status: body.status,
    lastEventType: body.lastEventType ?? 'heartbeat',
    lastEventSummary: body.lastEventSummary ?? 'heartbeat',
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
