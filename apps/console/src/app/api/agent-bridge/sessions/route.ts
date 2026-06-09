import { humanJson } from '@/lib/api/human-json';
/**
 * GET /api/agent-bridge/sessions — list bridge sessions
 */
import { NextRequest } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { listBridgeSessions, latestBridgeSession } from '@/lib/agent-bridge/store';
import { bridgeRail } from '@/lib/rails/responses';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiKey(req, [API_KEY_SCOPES.AGENT_BRIDGE_WRITE, API_KEY_SCOPES.AGENT_BRIDGE_RECEIPT]);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get('limit')) || 20, 100);

    const [sessions, latest] = await Promise.all([
      listBridgeSessions(limit),
      latestBridgeSession(),
    ]);

    return humanJson(req, {
      ok: true,
      ...bridgeRail(),
      sessions,
      latestSessionId: latest?.sessionId ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return humanJson(req, { ok: false, ...bridgeRail(), error: 'sessions_failed', message }, { status: 500 });
  }
}
