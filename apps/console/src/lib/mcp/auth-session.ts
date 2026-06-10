import type { McpSession } from '@/lib/agent-accounts/types';
import type { McpAuthContext } from './auth';
export function authAsLegacySession(auth: McpAuthContext): McpSession {
  if (auth.legacySession) return auth.legacySession;
  const now = new Date().toISOString();
  return { id:auth.connectionId, tokenHash:'', ownerAddress:auth.ownerWallet, agentAccountAddress:'', permissions:auth.policy, autoApprove:false, expiresAt:new Date(Date.now()+3600_000).toISOString(), revokedAt:null, createdAt:now, lastUsedAt:now, status:'active' };
}
