import { humanJson } from '@/lib/api/human-json';
import { NextResponse, type NextRequest } from 'next/server';
import { withNative } from '@/lib/x402/middleware';
import { latestBridgeSession, listBridgeEvents, listBridgeReceipts, stablePayloadHash } from '@/lib/agent-bridge/store';
import { bridgeRail } from '@/lib/rails/responses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BridgeScope = 'summary' | 'full_events' | 'receipts' | 'payload' | 'external_trace' | 'market_data';
const SCOPES = new Set<BridgeScope>(['summary', 'full_events', 'receipts', 'payload', 'external_trace', 'market_data']);

async function handler(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const requestedScopeRaw = typeof body.scope === 'string' ? body.scope.trim() : '';
  if (!SCOPES.has(requestedScopeRaw as BridgeScope)) {
    return humanJson(req, { ok: false, ...bridgeRail(), error: 'invalid_scope', message: 'Scope must be summary, full_events, receipts, payload, external_trace, or market_data.' }, { status: 400 });
  }
  const requestedScope = requestedScopeRaw as BridgeScope;
  const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';
  if (!['oracle', 'analyzer', 'evaluator', 'executor'].includes(role)) {
    return humanJson(req, { ok: false, ...bridgeRail(), error: 'invalid_role', message: 'Role must be oracle, analyzer, evaluator, or executor.' }, { status: 400 });
  }
  const latest = await latestBridgeSession();
  const hasInputSession = typeof body.sessionId === 'string' && body.sessionId.trim().length > 0;
  const sessionId = hasInputSession ? String(body.sessionId).trim() : null;
  if (!sessionId) {
    return humanJson(req, { ok: false, ...bridgeRail(), error: 'invalid_session', message: 'Missing bridge session id.' }, { status: 400 });
  }
  if (latest?.sessionId !== sessionId) {
    const existingEvents = await listBridgeEvents({ sessionId, limit: 1 });
    if (!existingEvents.length) {
      return humanJson(req, { ok: false, ...bridgeRail(), error: 'rail_session_not_found', sessionId, scope: requestedScope, message: 'Bridge session was not found or already expired.' }, { status: 404 });
    }
  }

  const isLatestSession = latest?.sessionId === sessionId;

  // P0.8: Never use latest session data for a different requested sessionId
  let sessionEvents: import('@/lib/agent-bridge/store').BridgeEventRow[] = [];
  let sessionReceipts: import('@/lib/agent-bridge/store').BridgeReceiptRow[] = [];

  if (requestedScope === 'summary') {
    if (isLatestSession) {
      sessionEvents = latest?.events?.slice(-5) ?? [];
      sessionReceipts = latest?.receipts ?? [];
    } else {
      sessionEvents = (await listBridgeEvents({ sessionId, limit: 5 })).slice(-5);
      sessionReceipts = await listBridgeReceipts(sessionId);
    }
  } else {
    sessionEvents = await listBridgeEvents({ sessionId, limit: 100 });
    if (['full_events', 'receipts', 'external_trace', 'market_data'].includes(requestedScope)) {
      sessionReceipts = await listBridgeReceipts(sessionId);
    }
  }

  const events = sessionEvents;
  const receipts = ['summary', 'full_events', 'receipts', 'external_trace', 'market_data'].includes(requestedScope) ? sessionReceipts : [];
  const payloadHash = stablePayloadHash({ sessionId, scope: requestedScope, eventCount: events.length, receiptCount: receipts.length });

  const response = humanJson(req, {
    ok: true,
    ...bridgeRail(),
    access: 'unlocked',
    scope: requestedScope,
    role,
    sessionId,
    summary: isLatestSession && latest ? latest : { sessionId, events: events.slice(-5), receipts },
    events: requestedScope === 'summary' ? undefined : events,
    receipts,
    payloadHash,
  });

  response.headers.set('X-Agent-Bridge-Session-Id', sessionId);
  response.headers.set('X-Agent-Bridge-Payload-Hash', payloadHash);
  response.headers.set('X-Agent-Bridge-Scope', requestedScope);
  response.headers.set('X-Agent-Bridge-Role', role);
  return response;
}

export const POST = withNative(handler, {
  amount: '1',
  resource: '/api/x402/bridge-access',
  description: 'ArcLayer external agent bridge access',
});
