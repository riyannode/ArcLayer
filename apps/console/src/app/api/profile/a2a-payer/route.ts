import { humanJson } from '@/lib/api/human-json';
/**
 * /api/profile/a2a-payer
 *
 * Returns explicit A2A x402 payer status for the authenticated wallet's agents.
 * Agent Account auto-binding is optional and only runs when explicitly enabled.
 * No private keys. No payment verification or settlement.
 */

import { NextRequest } from 'next/server';
import { resolveSessionFromCookie, SESSION_COOKIE_NAME, getLinkedErc8004AgentsForController } from '@/lib/auth/wallet-session';
import { getActiveAgentAccountForOwner } from '@/lib/agent-accounts/store';
import { getActiveA2aPayer, ensureA2aPayerBinding } from '@/lib/x402/agent-payer';
import {
  isAgentAccountA2aAutoBindEnabled,
  isAgentAccountServerRailEnabled,
} from '@/lib/agent-accounts/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

export async function GET(req: NextRequest) {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) return humanJson(req, { ok: false, error: 'not_authenticated' }, { status: 401, headers: { 'Cache-Control': ERROR_CACHE } });

  const session = await resolveSessionFromCookie(cookieValue);
  if (!session) return humanJson(req, { ok: false, error: 'invalid_session' }, { status: 401, headers: { 'Cache-Control': ERROR_CACHE } });

  const wallet = session.wallet;
  const agentAccount = isAgentAccountServerRailEnabled()
    ? await getActiveAgentAccountForOwner(wallet)
    : null;
  const agentAccountAddr = agentAccount?.agentAccountAddress ?? null;
  const ownerAgents = await getLinkedErc8004AgentsForController(wallet);
  const accountAgents =
    isAgentAccountServerRailEnabled() &&
    agentAccountAddr &&
    agentAccountAddr.toLowerCase() !== wallet.toLowerCase()
      ? await getLinkedErc8004AgentsForController(agentAccountAddr)
      : [];

  const agentMap = new Map<string, { agentId: string; controller: string }>();
  for (const agent of ownerAgents) agentMap.set(agent.agentId, { agentId: agent.agentId, controller: wallet });
  for (const agent of accountAgents) agentMap.set(agent.agentId, { agentId: agent.agentId, controller: agentAccountAddr! });

  const agentA2aPayers: Array<{ agentId: string; payerAddress: string; repaired?: boolean }> = [];
  for (const agent of agentMap.values()) {
    let binding = await getActiveA2aPayer(agent.agentId);
    if (!binding && agentAccountAddr && isAgentAccountA2aAutoBindEnabled()) {
      binding = await ensureA2aPayerBinding({ agentId: agent.agentId, controllerAddress: agent.controller, agentAccountAddress: agentAccountAddr }).catch(() => null);
      if (binding) {
        agentA2aPayers.push({ agentId: agent.agentId, payerAddress: binding.payerAddress, repaired: true });
        continue;
      }
    }
    if (binding) agentA2aPayers.push({ agentId: agent.agentId, payerAddress: binding.payerAddress });
  }

  const a2aPayerEnabled = agentA2aPayers.length > 0;
  return humanJson(req, {
    ok: true,
    hasAgentAccount: isAgentAccountServerRailEnabled() && Boolean(agentAccountAddr),
    agentAccountAddress: isAgentAccountServerRailEnabled() ? agentAccountAddr : null,
    a2aPayerEnabled,
    agents: agentA2aPayers,
    message: a2aPayerEnabled ? 'Bot EOA payer linked.' : 'No Bot EOA payer linked.',
  }, { status: 200, headers: { 'Cache-Control': ERROR_CACHE } });
}
