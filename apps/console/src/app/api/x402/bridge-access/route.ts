import { NextResponse, type NextRequest } from 'next/server';
import { withNative } from '@/lib/x402/middleware';
import { latestBridgeSession, listBridgeEvents, listBridgeReceipts, makeSessionId, stablePayloadHash } from '@/lib/agent-bridge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BridgeScope = 'summary' | 'full_events' | 'receipts' | 'payload' | 'external_trace';
const SCOPES = new Set<BridgeScope>(['summary', 'full_events', 'receipts', 'payload', 'external_trace']);

async function handler(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const requestedScope = typeof body.scope === 'string' && SCOPES.has(body.scope as BridgeScope) ? (body.scope as BridgeScope) : 'summary';
  const latest = await latestBridgeSession();
  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : latest?.sessionId ?? makeSessionId('bridge_access');

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
