import { humanJson } from '@/lib/api/human-json';
/**
 * DELETE /api/agents/[id]/api-keys/[keyId]
 *
 * Revoke an API key. Requires wallet session auth.
 * Only agent controller/owner can revoke keys.
 * Supports both EOA-minted and Agent Account-minted agents.
 */

import { NextRequest } from 'next/server';
import { getAddress } from 'viem';
import { revokeApiKey } from '@/lib/a2a/auth';
import { getERC8004OwnerOf } from '@/lib/contracts/erc8004';
import { isAgentAccountServerRailEnabled } from '@/lib/agent-accounts/feature-flags';
import {
  resolveSessionFromCookie,
  getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';
import {
  getActiveAgentAccountForOwner,
  getActiveAgentAccountForOwnerAndAddress,
} from '@/lib/agent-accounts/store';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> },
) {
  try {
    const { id: agentId, keyId } = await params;

    // Auth: wallet session required
    const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!cookieValue) {
      return humanJson(req, { ok: false, error: 'unauthorized', detail: 'Wallet session required' }, { status: 401, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    const session = await resolveSessionFromCookie(cookieValue);
    if (!session) {
      return humanJson(req, { ok: false, error: 'invalid_session', detail: 'Wallet session is invalid or expired' }, { status: 401, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    // Verify ownership — check EOA-minted agents first
    const linkedAgents = await getLinkedErc8004AgentsForController(session.wallet);
    const ownsEoaAgent = linkedAgents.some(
      (a) => a.tokenId === agentId || a.agentId === agentId,
    );

    let hasOwnership = ownsEoaAgent;

    // Also check Agent Account-minted agents
    if (!hasOwnership && isAgentAccountServerRailEnabled()) {
      try {
        const agentAccount = await getActiveAgentAccountForOwner(session.wallet);
        if (agentAccount?.agentAccountAddress) {
          const agentAccountLinked = await getLinkedErc8004AgentsForController(
            agentAccount.agentAccountAddress,
          );
          hasOwnership = agentAccountLinked.some(
            (a) => a.tokenId === agentId || a.agentId === agentId,
          );
        }
      } catch {
        hasOwnership = false;
      }
    }

    if (!hasOwnership && /^\d+$/.test(agentId)) {
      try {
        const onchainOwner = getAddress(await getERC8004OwnerOf(agentId)).toLowerCase();

        if (session.wallet.toLowerCase() === onchainOwner) {
          hasOwnership = true;
        } else if (isAgentAccountServerRailEnabled()) {
          const activeBinding = await getActiveAgentAccountForOwnerAndAddress(
            session.wallet,
            onchainOwner,
          );
          hasOwnership = Boolean(activeBinding);
        }
      } catch {
        hasOwnership = false;
      }
    }

    if (!hasOwnership) {
      return humanJson(req, { ok: false, error: 'forbidden', detail: 'Session wallet does not control this agent' }, { status: 403, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    // Revoke
    const success = await revokeApiKey(keyId, agentId);
    if (!success) {
      return humanJson(req, { ok: false, error: 'revoke_failed', detail: 'Key not found or already revoked' }, { status: 404, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    return humanJson(req, { ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return humanJson(req, { ok: false, error: 'api_key_revoke_failed', detail: message }, { status: 500, headers: { 'Cache-Control': ERROR_CACHE } });
  }
}
