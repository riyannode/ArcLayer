/**
 * /api/profile/a2a-payer
 *
 * GET: Returns A2A x402 payer status for the authenticated wallet's agents.
 *
 * Lazy repair: if an agent has an Agent Account but no A2A binding,
 * auto-creates the binding. Idempotent. Handles:
 * 1. Agent Account created after agents
 * 2. Agent created after Agent Account
 * 3. Existing users before migration
 *
 * Binds agents controlled by BOTH owner EOA and agentAccountAddress,
 * since MCP identity flow mints agents to agentAccountAddress.
 *
 * Read-only response. Mutation is internal (ensureA2aPayerBinding only).
 * No private keys. No Phase 3 x402 verify/settle.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromCookie, SESSION_COOKIE_NAME, getLinkedErc8004AgentsForController } from '@/lib/auth/wallet-session';
import { getActiveAgentAccountForOwner } from '@/lib/agent-accounts/store';
import { getActiveA2aPayer, ensureA2aPayerBinding } from '@/lib/x402/agent-payer';

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

  const agentAccountAddr = agentAccount.agentAccountAddress;

  // Enumerate agents controlled by BOTH owner EOA and agentAccountAddress.
  // MCP identity flow mints agents to agentAccountAddress, not owner EOA.
  const [ownerAgents, accountAgents] = await Promise.all([
    getLinkedErc8004AgentsForController(wallet),
    agentAccountAddr.toLowerCase() !== wallet.toLowerCase()
      ? getLinkedErc8004AgentsForController(agentAccountAddr)
      : Promise.resolve([]),
  ]);

  // Dedupe by agentId (accountAgents wins if overlap)
  const agentMap = new Map<string, { agentId: string; controller: string }>();
  for (const a of ownerAgents) agentMap.set(a.agentId, { agentId: a.agentId, controller: wallet });
  for (const a of accountAgents) agentMap.set(a.agentId, { agentId: a.agentId, controller: agentAccountAddr });
  const allAgents = [...agentMap.values()];

  // Check each agent for A2A binding; lazy-repair if missing
  const agentA2aPayers: Array<{ agentId: string; payerAddress: string; repaired?: boolean }> = [];

  for (const agent of allAgents) {
    const binding = await getActiveA2aPayer(agent.agentId);
    if (binding) {
      agentA2aPayers.push({
        agentId: agent.agentId,
        payerAddress: binding.payerAddress,
      });
    } else {
      // Lazy repair: create missing A2A binding
      try {
        const result = await ensureA2aPayerBinding({
          agentId: agent.agentId,
          controllerAddress: agent.controller,
          agentAccountAddress: agentAccountAddr,
        });
        if (result) {
          agentA2aPayers.push({
            agentId: agent.agentId,
            payerAddress: result.payerAddress,
            repaired: true,
          });
        }
      } catch {
        // Non-critical: report pending if repair fails
      }
    }
  }

  const a2aPayerEnabled = agentA2aPayers.length > 0;

  return NextResponse.json({
    ok: true,
    hasAgentAccount: true,
    agentAccountAddress: agentAccountAddr,
    a2aPayerEnabled,
    agents: agentA2aPayers,
    message: a2aPayerEnabled
      ? 'A2A x402 payer: Agent Account'
      : 'Agent Account linked. A2A payer binding pending.',
  }, { status: 200, headers: { 'Cache-Control': ERROR_CACHE } });
}
