import type { McpSession } from '@/lib/agent-accounts/types';
import type { McpAuthContext } from './auth';

/**
 * Extract or synthesize a McpSession from auth context.
 * Prefers runtimeSession if available; otherwise builds a synthetic session.
 */
export function authAsRuntimeSession(auth: McpAuthContext): McpSession {
  if (auth.runtimeSession) return auth.runtimeSession;
  const now = new Date().toISOString();
  return {
    id: auth.connectionId,
    tokenHash: '',
    ownerAddress: auth.ownerWallet,
    agentAccountAddress: '',
    permissions: auth.policy,
    autoApprove: false,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    revokedAt: null,
    createdAt: now,
    lastUsedAt: now,
    status: 'active',
  };
}

/** @deprecated Use authAsRuntimeSession */
export const authAsLegacySession = authAsRuntimeSession;
