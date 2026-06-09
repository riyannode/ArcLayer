import { humanJson } from '@/lib/api/human-json';
/**
 * POST /api/auth/logout
 *
 * Revokes the wallet session in DB and clears the cookie.
 */

import { NextRequest } from 'next/server';
import {
  destroySession,
  buildClearSessionCookie,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (cookieValue) {
    await destroySession(cookieValue);
  }

  const res = humanJson(req, { ok: true }, { headers: { 'Cache-Control': 'no-store' } });

  res.headers.set('Set-Cookie', buildClearSessionCookie());

  return res;
}
