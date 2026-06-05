/**
 * MCP Session — Revoke.
 *
 * POST /api/mcp/sessions/revoke
 * Auth: wallet session cookie.
 * Body: { sessionId? }
 *
 * If sessionId is provided, revokes that specific session.
 * If sessionId is omitted, revokes ALL sessions for the owner.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateWalletRequest } from '@/lib/mcp/session-auth';
import { revokeSession, revokeAllSessionsForOwner } from '@/lib/mcp/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // 1. Authenticate wallet session
  const auth = await authenticateWalletRequest(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  // 2. Parse body
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;

  // 3. Revoke
  if (sessionId) {
    const revoked = await revokeSession(sessionId, auth.wallet);
    if (!revoked) {
      return NextResponse.json(
        { ok: false, error: 'session_not_found_or_already_revoked' },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, revoked: 1, sessionId });
  }

  // Revoke all
  const count = await revokeAllSessionsForOwner(auth.wallet);
  return NextResponse.json({ ok: true, revoked: count });
}
