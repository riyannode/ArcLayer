/**
 * GET /api/agent-bridge/sessions/[sessionId] — bridge session detail
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { listBridgeEvents, listBridgeReceipts, stablePayloadHash } from '@/lib/agent-bridge/store';
import { bridgeRail } from '@/lib/rails/responses';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> | { sessionId: string } },
) {
  try {
    const auth = await requireApiKey(_req, [API_KEY_SCOPES.AGENT_BRIDGE_WRITE, API_KEY_SCOPES.AGENT_BRIDGE_RECEIPT]);
    if (auth.error) return auth.error;

    const { sessionId } = await params;

    const [events, receipts] = await Promise.all([
      listBridgeEvents({ sessionId, limit: 200 }),
      listBridgeReceipts(sessionId),
    ]);

    if (!events.length && !receipts.length) {
      return NextResponse.json(
        { ok: false, error: 'session_not_found', sessionId, message: 'Bridge session not found.' },
        { status: 404 },
      );
    }

    const payloadHash = stablePayloadHash({
      sessionId,
      eventCount: events.length,
      receiptCount: receipts.length,
    });

    return NextResponse.json({
      ok: true,
      ...bridgeRail(),
      sessionId,
      eventCount: events.length,
      receiptCount: receipts.length,
      events,
      receipts,
      payloadHash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'session_detail_failed', message },
      { status: 500 },
    );
  }
}
