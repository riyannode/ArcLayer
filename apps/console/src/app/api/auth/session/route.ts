/**
 * GET /api/auth/session
 *
 * Returns the current wallet session status from the httpOnly cookie,
 * including linked ERC-8004 agents for the authenticated wallet.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveSessionFromCookie,
  getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

const EMPTY_LINKED_AGENTS: never[] = [];

export async function GET(req: NextRequest) {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!cookieValue) {
    return NextResponse.json(
      { ok: true, authenticated: false, linkedAgents: EMPTY_LINKED_AGENTS },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const session = await resolveSessionFromCookie(cookieValue);

  if (!session) {
    const res = NextResponse.json(
      { ok: true, authenticated: false, linkedAgents: EMPTY_LINKED_AGENTS },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    res.headers.set(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    return res;
  }

  const linkedAgents = await getLinkedErc8004AgentsForController(session.wallet);

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      wallet: session.wallet,
      expiresAt: session.expiresAt,
      linkedAgents,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
