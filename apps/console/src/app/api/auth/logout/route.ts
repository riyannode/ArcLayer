/**
 * POST /api/auth/logout
 *
 * Destroys the wallet session and clears the cookie.
 * No authentication required — safe to call even without a session.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  destroySession,
  buildClearSessionCookie,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (cookieValue) {
    destroySession(cookieValue);
  }

  const res = NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );

  res.headers.set('Set-Cookie', buildClearSessionCookie());

  return res;
}
