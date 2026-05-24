import { NextResponse, type NextRequest } from 'next/server';
import { withNative } from '@/lib/x402/middleware';
import { latestBridgeSession, listBridgeEvents, listBridgeReceipts, stablePayloadHash } from '@/lib/agent-bridge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BridgeScope = 'summary' | 'full_events' | 'receipts' | 'payload' | 'external_trace';
const SCOPES = new Set<BridgeScope>(['summary', 'full_events', 'receipts', 'payload', 'external_trace']);

async function handler(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const requestedScope = typeof body.scope === 'string' && SCOPES.has(body.scope as BridgeScope) ? (body.scope as BridgeScope) : 'summary';
  const latest = await latestBridgeSession();
  const hasInputSession = typeof body.sessionId === 'string' && body.sessionId.trim().length > 0;
  const sessionId = hasInputSession ? String(body.sessionId).trim() : latest?.sessionId ?? null;
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'invalid_session', message: 'Missing bridge session id.' }, { status: 400 });
  }
  if (hasInputSession && latest?.sessionId !== sessionId) {
    const existingEvents = await listBridgeEvents({ sessionId, limit: 1 });
    if (!existingEvents.length) {
      return NextResponse.json({ ok: false, error: 'rail_session_not_found', sessionId, scope: requestedScope, message: 'Bridge session was not found or already expired.' }, { status: 404 });
    }
  }

  const events = requestedScope === 'summary' ? latest?.events?.slice(-5) ?? [] : await listBridgeEvents({ sessionId, limit: 100 });
  const receipts = requestedScope === 'full_events' || requestedScope === 'receipts' || requestedScope === 'external_trace' ? await listBridgeReceipts(sessionId) : latest?.receipts ?? [];
  const payloadHash = stablePayloadHash({ sessionId, scope: requestedScope, eventCount: events.length, receiptCount: receipts.length });

  const response = NextResponse.json({
    ok: true,
    access: 'unlocked',
    scope: requestedScope,
    sessionId,
    summary: latest && latest.sessionId === sessionId ? latest : { sessionId, events: events.slice(-5), receipts },
    events: requestedScope === 'summary' ? undefined : events,
    receipts,
    payloadHash,
  });

  response.headers.set('X-Agent-Bridge-Session-Id', sessionId);
  response.headers.set('X-Agent-Bridge-Payload-Hash', payloadHash);
  response.headers.set('X-Agent-Bridge-Scope', requestedScope);
  return response;
}

export const POST = withNative(handler, {
  amount: '1',
  resource: '/api/x402/bridge-access',
  description: 'ArcLayer external agent bridge access',
});
