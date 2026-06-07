/**
 * POST /api/mcp/signing-sessions/[id]/heartbeat
 *
 * Updates last_seen_at and extends active session.
 * Auth: wallet session cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveSessionFromCookie,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';
import { heartbeatSession, getSession } from '@/lib/mcp/signing-bridge/store';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  }

  const session = await resolveSessionFromCookie(cookieValue);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'session_expired' }, { status: 401 });
  }

  // Verify ownership
  const signingSession = await getSession(id);
  if (!signingSession || signingSession.owner_wallet.toLowerCase() !== session.wallet.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const ok = await heartbeatSession(id);
  return NextResponse.json({ ok });
}
