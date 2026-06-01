/**
 * POST /api/auth/wallet/verify
 *
 * Verifies EIP-191 signature over the nonce message and creates an httpOnly session cookie.
 *
 * Body: { wallet: "0x...", nonce: "...", signature: "0x..." }
 *
 * On success:
 *   - Sets `arclayer-wallet-session` httpOnly cookie (24h TTL)
 *   - Returns { ok: true, wallet, expiresAt }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAndCreateSession,
  buildNonceSignMessage,
  buildSessionCookie,
} from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.wallet || typeof body.wallet !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'missing_wallet', detail: 'wallet is required' },
        { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    if (!body.nonce || typeof body.nonce !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'missing_nonce', detail: 'nonce is required' },
        { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    if (!body.signature || typeof body.signature !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'missing_signature', detail: 'signature is required' },
        { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    const result = await verifyAndCreateSession({
      wallet: body.wallet,
      nonce: body.nonce,
      signature: body.signature,
    });

    if (!result.ok) {
      const status =
        result.error === 'nonce_not_found' || result.error === 'nonce_used' || result.error === 'nonce_expired'
          ? 401
          : result.error === 'invalid_wallet' || result.error === 'invalid_signature'
            ? 400
            : 401;

      return NextResponse.json(
        { ok: false, error: result.error, detail: result.detail },
        { status, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    const res = NextResponse.json(
      {
        ok: true,
        wallet: result.session.wallet,
        expiresAt: result.session.expiresAt,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );

    // Set httpOnly session cookie
    if (result.cookieToken) {
      res.headers.set('Set-Cookie', buildSessionCookie(result.cookieToken));
    }

    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json(
      { ok: false, error: 'verify_failed', detail: message },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }
}
