/**
 * POST /api/mcp/signing-requests/[id]/claim
 *
 * Atomic claim: pending → signing.
 * Verifies connected wallet matches expectedClientWallet.
 * Auth: wallet session cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveSessionFromCookie,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';
import { claimRequest, getRequest } from '@/lib/mcp/signing-bridge/store';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Auth: wallet session required
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  }

  const session = await resolveSessionFromCookie(cookieValue);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'session_expired' }, { status: 401 });
  }

  try {
    // First, read the request to verify wallet match
    const request = await getRequest(id);
    if (!request) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    if (request.status !== 'pending') {
      return NextResponse.json(
        { ok: false, error: 'invalid_status', detail: `Request is ${request.status}, not pending` },
        { status: 409 },
      );
    }

    // Verify connected wallet matches expected client wallet
    if (session.wallet.toLowerCase() !== request.expected_client_wallet.toLowerCase()) {
      return NextResponse.json(
        { ok: false, error: 'wallet_mismatch', detail: 'Connected wallet does not match expected client wallet' },
        { status: 403 },
      );
    }

    // Atomic claim
    const claimed = await claimRequest(id, request.session_id);
    if (!claimed) {
      return NextResponse.json(
        { ok: false, error: 'already_claimed', detail: 'Request was claimed by another session/tab' },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      request: {
        id: claimed.id,
        status: claimed.status,
        transactions: claimed.transactions,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'claim_failed' },
      { status: 500 },
    );
  }
}
