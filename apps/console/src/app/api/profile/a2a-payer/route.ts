/**
 * /api/profile/a2a-payer
 *
 * GET: Returns A2A x402 payer status for the authenticated wallet's agents.
 *
 * If an ERC-8004 agent has a Circle Agent Account, that Agent Account address
 * is automatically the x402 payer for A2A circle-gateway payments.
 *
 * Read-only. No mutation. No private keys.
 *
 * Scope: x402 A2A payer status for profile page display.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromCookie, SESSION_COOKIE_NAME, getLinkedErc8004AgentsForController } from '@/lib/auth/wallet-session';
import { getActiveAgentAccountForOwner } from '@/lib/agent-accounts/store';
import { getActiveA2aPayer } from '@/lib/x402/agent-payer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

export async function GET(req: NextRequest) {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return NextResponse.json({ ok: false, error: 'not_authenticated' }, { status: 401, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  const session = await resolveSessionFromCookie(cookieValue);
  if (!session) {
    return NextResponse.json({ ok: false, error: 'invalid_session' }, { status: 401, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  const wallet = session.wallet;

  // Check if Agent Account exists
  const agentAccount = await getActiveAgentAccountForOwner(wallet);

  if (!agentAccount?.agentAccountAddress) {
    return NextResponse.json({
      ok: true,
      hasAgentAccount: false,
      a2aPayerEnabled: false,
      message: 'Create Agent Account to enable A2A x402 payer.',
    }, { status: 200, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  // Find agents controlled by this wallet
  const linkedAgents = await getLinkedErc8004AgentsForController(wallet);

  // Check if any agent has an active A2A payer binding
  const agentA2aPayers: Array<{ agentId: string; payerAddress: string }> = [];

  for (const agent of linkedAgents) {
    const binding = await getActiveA2aPayer(agent.agentId);
    if (binding) {
      agentA2aPayers.push({
        agentId: agent.agentId,
        payerAddress: binding.payerAddress,
      });
    }
  }

  const a2aPayerEnabled = agentA2aPayers.length > 0;

  return NextResponse.json({
    ok: true,
    hasAgentAccount: true,
    agentAccountAddress: agentAccount.agentAccountAddress,
    a2aPayerEnabled,
    agents: agentA2aPayers,
    message: a2aPayerEnabled
      ? 'A2A x402 payer: Agent Account'
      : 'Agent Account linked. A2A payer binding pending.',
  }, { status: 200, headers: { 'Cache-Control': ERROR_CACHE } });
}
