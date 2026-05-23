import { NextResponse } from 'next/server';
import { listAgentLiveEventsByCategory, recordAgentLiveEvent } from '@/lib/a2a/live-events';

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
  const limit = Number.parseInt(searchParams.get('limit') || '50', 10);

  const events = await listAgentLiveEventsByCategory(category, Number.isFinite(limit) ? limit : 50);

  return NextResponse.json({
    ok: true,
    category,
    total: events.length,
    events,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: Request) {
  const authError = requireWriteAuth(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
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
