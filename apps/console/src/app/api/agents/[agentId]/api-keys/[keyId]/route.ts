/**
 * DELETE /api/agents/[agentId]/api-keys/[keyId]
 *
 * Revoke an API key. Requires wallet session auth.
 * Only agent controller/owner can revoke keys.
 */

import { NextRequest, NextResponse } from 'next/server';
import { revokeApiKey } from '@/lib/a2a/auth';
import {
  resolveSessionFromCookie,
  getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string; keyId: string }> },
) {
  try {
    const { agentId, keyId } = await params;

    // Auth: wallet session required
    const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookieValue) {
      return NextResponse.json(
        { ok: false, error: 'unauthorized', detail: 'Wallet session required' },
        { status: 401, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    const session = await resolveSessionFromCookie(cookieValue);
    if (!session) {
      return NextResponse.json(
        { ok: false, error: 'invalid_session', detail: 'Wallet session is invalid or expired' },
        { status: 401, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // Verify ownership
    const linkedAgents = await getLinkedErc8004AgentsForController(session.wallet);
    const ownsAgent = linkedAgents.some(
      (a) => a.tokenId === agentId || a.agentId === agentId,
    );
    if (!ownsAgent) {
      return NextResponse.json(
        { ok: false, error: 'forbidden', detail: 'Session wallet does not control this agent' },
        { status: 403, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // Revoke
    const success = await revokeApiKey(keyId, agentId);
    if (!success) {
      return NextResponse.json(
        { ok: false, error: 'revoke_failed', detail: 'Key not found or already revoked' },
        { status: 404, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json(
      { ok: false, error: 'api_key_revoke_failed', detail: message },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }
}
