import { NextResponse, type NextRequest } from 'next/server';
import { withNative } from '@/lib/x402/middleware';
import { latestBridgeSession, makeSessionId, stablePayloadHash } from '@/lib/agent-bridge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handler(_req: NextRequest) {
  // ArcLayer is only the protocol/payment bridge. Trading logic runs in external PM2 bots.
  const latest = await latestBridgeSession();
  const sessionId = latest?.sessionId ?? makeSessionId('bridge_access');
  const payloadHash = stablePayloadHash({ sessionId, source: latest ? 'latest_pm2_session' : 'no_pm2_session_available' });

  const response = NextResponse.json({
    ok: true,
    sessionId,
    access: 'unlocked',
    session: latest,
  });

  // Consumed by x402 middleware after Arc Native settlement to attach PAYMENT-RESPONSE metadata to Supabase.
  response.headers.set('X-Agent-Bridge-Session-Id', sessionId);
  response.headers.set('X-Agent-Bridge-Payload-Hash', payloadHash);
  return response;
}

export const POST = withNative(handler, {
  amount: '1',
  resource: '/api/x402/bridge-access',
  description: 'ArcLayer agent bridge access',
});
