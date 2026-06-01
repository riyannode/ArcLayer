/**
 * GET /api/auth/session
 *
 * Returns the current wallet session status from the httpOnly cookie.
 * No authentication required — returns { authenticated: false } if no valid session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromCookie, SESSION_COOKIE_NAME } from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!cookieValue) {
    return NextResponse.json(
      { authenticated: false },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const session = resolveSessionFromCookie(cookieValue);

  if (!session) {
    // Cookie present but invalid/expired — clear it
    const res = NextResponse.json(
      { authenticated: false },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    res.headers.set(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    return res;
  }

  return NextResponse.json(
    {
      authenticated: true,
      wallet: session.wallet,
      expiresAt: session.expiresAt,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
