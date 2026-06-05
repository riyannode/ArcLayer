/**
 * Profile — Agent Account link/read.
 *
 * GET  /api/profile/agent-account — returns linked agent account for owner
 * POST /api/profile/agent-account/link — links an agent account to owner
 *
 * Auth: wallet session cookie.
 * No tx execution. No private keys.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromCookie, SESSION_COOKIE_NAME } from '@/lib/auth/wallet-session';
import {
  getActiveAgentAccountForOwner,
  upsertAgentAccountForOwner,
} from '@/lib/agent-accounts/store';
import { isAddress, getAddress } from 'viem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getWallet(req: NextRequest): Promise<string | null> {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) return null;
  const session = await resolveSessionFromCookie(cookieValue);
  return session?.wallet ?? null;
}

export async function GET(req: NextRequest) {
  const wallet = await getWallet(req);
  if (!wallet) {
    return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  }

  const account = await getActiveAgentAccountForOwner(wallet);

  if (!account) {
    return NextResponse.json({
      ok: true,
      ownerAddress: getAddress(wallet),
      agentAccountAddress: null,
      status: 'not_created',
      chainId: 5042002,
    });
  }

  return NextResponse.json({
    ok: true,
    ownerAddress: account.ownerAddress,
    agentAccountAddress: account.agentAccountAddress,
    status: account.status,
    chainId: account.chainId,
    walletProvider: account.walletProvider,
    accountType: account.accountType,
  });
}

export async function POST(req: NextRequest) {
  const wallet = await getWallet(req);
  if (!wallet) {
    return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const raw = typeof body.agentAccountAddress === 'string' ? body.agentAccountAddress.trim() : '';
  if (!raw || !isAddress(raw)) {
    return NextResponse.json({ ok: false, error: 'invalid_address' }, { status: 400 });
  }

  const agentAccountAddress = getAddress(raw);
  const ownerAddress = getAddress(wallet);

  const account = await upsertAgentAccountForOwner({
    ownerAddress,
    agentAccountAddress,
  });

  return NextResponse.json({
    ok: true,
    ownerAddress: account.ownerAddress,
    agentAccountAddress: account.agentAccountAddress,
    status: account.status,
    chainId: account.chainId,
  });
}
