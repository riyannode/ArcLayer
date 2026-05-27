import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listAgentLiveEventsByCategory, recordAgentLiveEvent } from '@/lib/a2a/live-events';
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category')?.trim() || 'prediction-market-bots';
  const limit = Number.parseInt(searchParams.get('limit') || '50', 10);

  try {
    const events = await listAgentLiveEventsByCategory(category, Number.isFinite(limit) ? limit : 50);

    return NextResponse.json({
      ok: true,
      source: process.env.A2A_AGENT_ROSTER_SOURCE || 'local-indexer',
      category,
      total: events.length,
      events,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      ok: false,
      source: 'local-indexer',
      category,
      total: 0,
      events: [],
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

  // Dual auth: global A2A_LIVE_EVENTS_TOKEN OR per-agent ARCLAYER_API_KEY
  if (checkGlobalToken(request)) {
    // Global token passes — proceed with write (backward compat)
    const result = await recordAgentLiveEvent({
      agentId: body.agentId,
      agentName: body.agentName,
      eventType: body.eventType,
      title: body.title,
      summary: body.summary,
      txHash: body.txHash,
      amountAtomic: body.amountAtomic,
      currency: body.currency,
      decision: body.decision,
      confidence: body.confidence,
      trace: Array.isArray(body.trace) ? body.trace : [],
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  }

  // Try per-agent API key auth with live_events:write scope
  const auth = await requireApiKey(request, ['live_events:write']);
  if (auth.error) return auth.error;

  // Enforce key.agentId === body.agentId
  if (auth.key.agentId !== body.agentId) {
    return NextResponse.json(
      { ok: false, error: 'agent_id_mismatch', key_agent: auth.key.agentId, body_agent: body.agentId },
      { status: 403 },
    );
  }

  const result = await recordAgentLiveEvent({
    agentId: body.agentId,
    agentName: body.agentName,
    eventType: body.eventType,
    title: body.title,
    summary: body.summary,
    txHash: body.txHash,
    amountAtomic: body.amountAtomic,
    currency: body.currency,
    decision: body.decision,
    confidence: body.confidence,
    trace: Array.isArray(body.trace) ? body.trace : [],
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
