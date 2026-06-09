import { humanJson } from '@/lib/api/human-json';
/**
 * Profile — Agent Account link/read.
 *
 * GET  /api/profile/agent-account — returns linked agent account for owner
 * POST /api/profile/agent-account/link — links an agent account to owner
 *
 * Auth: wallet session cookie.
 * No tx execution. No private keys.
 */

import { NextRequest } from 'next/server';
import { resolveSessionFromCookie, SESSION_COOKIE_NAME, getLinkedErc8004AgentsForController } from '@/lib/auth/wallet-session';
import {
  getActiveAgentAccountForOwner,
  upsertAgentAccountForOwner,
} from '@/lib/agent-accounts/store';
import { ensureA2aPayerBinding } from '@/lib/x402/agent-payer';
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
    return humanJson(req, { ok: false, error: 'not_authenticated' }, { status: 401 });
  }

  const account = await getActiveAgentAccountForOwner(wallet);

  if (!account) {
    return humanJson(req, {
      ok: true,
      ownerAddress: getAddress(wallet),
      agentAccountAddress: null,
      status: 'not_created',
      chainId: 5042002,
    });
  }

  return humanJson(req, {
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
  if (process.env.AGENT_ACCOUNT_BACKEND_ENABLED !== 'true') {
    return humanJson(req, { ok: false, error: 'agent_account_disabled', detail: 'Agent Account mode is temporarily disabled. Use EOA bot mode.' }, { status: 403 });
  }

  const wallet = await getWallet(req);
  if (!wallet) {
    return humanJson(req, { ok: false, error: 'not_authenticated' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return humanJson(req, { ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const raw = typeof body.agentAccountAddress === 'string' ? body.agentAccountAddress.trim() : '';
  if (!raw || !isAddress(raw)) {
    return humanJson(req, { ok: false, error: 'invalid_address' }, { status: 400 });
  }

  const agentAccountAddress = getAddress(raw);
  const ownerAddress = getAddress(wallet);

  const account = await upsertAgentAccountForOwner({
    ownerAddress,
    agentAccountAddress,
  });

  if (process.env.AGENT_ACCOUNT_A2A_AUTO_BIND_ENABLED === 'true') {
    // Optional passkey mode: bind the Agent Account as A2A payer for owned agents.
    try {
      const linkedAgents = await getLinkedErc8004AgentsForController(ownerAddress);
      for (const agent of linkedAgents) {
        await ensureA2aPayerBinding({
          agentId: agent.agentId,
          controllerAddress: ownerAddress,
          agentAccountAddress,
        }).catch(() => {});
      }
    } catch {
      // Non-critical: optional A2A binding is best-effort on account creation
    }
  }

  return humanJson(req, {
    ok: true,
    ownerAddress: account.ownerAddress,
    agentAccountAddress: account.agentAccountAddress,
    status: account.status,
    chainId: account.chainId,
  });
}
