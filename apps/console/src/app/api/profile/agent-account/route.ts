import { humanJson } from '@/lib/api/human-json';
/**
 * Profile — Circle Agent Wallet link/read.
 *
 * GET  /api/profile/agent-account — returns linked Circle Agent Wallet for admin wallet
 * POST /api/profile/agent-account — links the current Circle Agent Wallet address returned by Circle passkey login/register
 *
 * Auth: wallet session cookie.
 *
 * Security note:
 * This endpoint does not provide final cryptographic Agent Wallet control proof.
 * Manual arbitrary address linking is disabled in the default UI.
 * Final proof via ERC-1271 / isValidSignature is a future hardening step after Circle
 * smart-account message signing is confirmed in the app flow.
 */

import { NextRequest } from 'next/server';
import { resolveSessionFromCookie, SESSION_COOKIE_NAME, getLinkedErc8004AgentsForController } from '@/lib/auth/wallet-session';
import {
  getActiveAgentAccountForOwner,
  upsertAgentAccountForOwner,
} from '@/lib/agent-accounts/store';
import { ensureA2aPayerBinding } from '@/lib/x402/agent-payer';
import {
  isAgentAccountA2aAutoBindEnabled,
  isAgentAccountServerRailEnabled,
} from '@/lib/agent-accounts/feature-flags';
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
  if (!isAgentAccountServerRailEnabled()) {
    return humanJson(req, {
      ok: true,
      disabled: true,
      ownerAddress: null,
      agentAccountAddress: null,
      status: 'disabled',
      chainId: 5042002,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

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
  if (!isAgentAccountServerRailEnabled()) {
    return humanJson(
      req,
      {
        ok: false,
        error: 'agent_account_disabled',
        detail: 'Agent Account rail is disabled. Use EOA controller mode.',
      },
      { status: 403 },
    );
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

  if (isAgentAccountA2aAutoBindEnabled()) {
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
