/**
 * POST /api/mcp/signing-sessions — Create a new signing session.
 * GET  /api/mcp/signing-sessions — List active sessions for connected wallet.
 *
 * Auth: wallet session cookie (arclayer-wallet-session).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveSessionFromCookie,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';
import { createSession } from '@/lib/mcp/signing-bridge/store';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export async function POST(req: NextRequest) {
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
    const signingSession = await createSession(session.wallet);

    return NextResponse.json({
      ok: true,
      session: {
        id: signingSession.id,
        pairingCode: signingSession.pairing_code,
        ownerWallet: signingSession.owner_wallet,
        status: signingSession.status,
        expiresAt: signingSession.expires_at,
        createdAt: signingSession.created_at,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'create_failed' },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
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
    const { data } = await getSupabaseAdmin()
      .from('mcp_signing_sessions')
      .select('*')
      .eq('owner_wallet', session.wallet.toLowerCase())
      .in('status', ['active', 'expired'])
      .order('created_at', { ascending: false })
      .limit(5);

    return NextResponse.json({
      ok: true,
      sessions: (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id,
        pairingCode: row.pairing_code,
        ownerWallet: row.owner_wallet,
        status: row.status,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'list_failed' },
      { status: 500 },
    );
  }
}
