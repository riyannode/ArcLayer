/**
 * GET /api/mcp/signing-sessions/[id] — Read session status.
 *
 * Auth: wallet session cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveSessionFromCookie,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';
import { getSession } from '@/lib/mcp/signing-bridge/store';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Auth: wallet session required
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return NextResponse.json(
      { ok: false, error: 'not_authenticated' },
      { status: 401 },
    );
  }

  const session = await resolveSessionFromCookie(cookieValue);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'session_expired' },
      { status: 401 },
    );
  }

  try {
    const signingSession = await getSession(id);
    if (!signingSession) {
      return NextResponse.json(
        { ok: false, error: 'not_found' },
        { status: 404 },
      );
    }

    // Only allow owner to view their own session
    if (signingSession.owner_wallet.toLowerCase() !== session.wallet.toLowerCase()) {
      return NextResponse.json(
        { ok: false, error: 'forbidden' },
        { status: 403 },
      );
    }

    return NextResponse.json({
      ok: true,
      session: {
        id: signingSession.id,
        pairingCode: signingSession.pairing_code,
        ownerWallet: signingSession.owner_wallet,
        status: signingSession.status,
        expiresAt: signingSession.expires_at,
        createdAt: signingSession.created_at,
        lastSeenAt: signingSession.last_seen_at,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'read_failed' },
      { status: 500 },
    );
  }
}
