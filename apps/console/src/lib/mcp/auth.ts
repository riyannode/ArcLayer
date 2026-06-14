import 'server-only';
import { resolveMcpSessionByToken } from '@/lib/agent-accounts/store';
import type { McpSession } from '@/lib/agent-accounts/types';
import { MCP_OAUTH_RESOURCE } from '@/lib/oauth/scopes';
import { hashOAuthSecret } from '@/lib/oauth/tokens';
import { oauthDb } from '@/lib/oauth/store';

export type McpAuthContext = {
  kind: 'oauth' | 'runtime_session';
  connectionId: string;
  ownerWallet: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  selectedAgentId: string | null;
  policy: Record<string, unknown>;
  runtimeSession?: McpSession;
};

function bearer(header?: string | null) {
  return header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

export async function resolveMcpBearerAuth(
  header?: string | null,
  options: { resource: string } = { resource: MCP_OAUTH_RESOURCE },
): Promise<McpAuthContext | null> {
  const token = bearer(header);
  if (!token) return null;

  // Runtime session token (arc_mcp_sess_ prefix)
  if (token.startsWith('arc_mcp_sess_')) {
    const session = await resolveMcpSessionByToken(token);
    if (!session) return null;

    // Derive scopes from session permissions
    // Priority: explicit scopes > derived from allowedContracts/allowedActions > default
    let scopes = session.permissions?.scopes;
    if (!Array.isArray(scopes) || scopes.length === 0) {
      // Legacy sessions store allowedContracts/allowedActions instead of scopes
      scopes = deriveScopesFromPermissions(session.permissions);
    }
    if (!scopes || scopes.length === 0) return null;

    // Reject wildcard scopes
    if (scopes.includes('*')) return null;

    return {
      kind: 'runtime_session',
      connectionId: session.id,
      ownerWallet: session.ownerAddress,
      clientId: 'runtime-session',
      clientName: 'ArcLayer Runtime Session',
      scopes,
      selectedAgentId: null,
      policy: session.permissions ?? {},
      runtimeSession: session,
    };
  }

  // OAuth token (arc_at_ prefix)
  if (!token.startsWith('arc_at_')) return null;

  const { data } = await oauthDb()
    .from('oauth_access_tokens')
    .select('*, mcp_oauth_connections(*)')
    .eq('token_hash', hashOAuthSecret(token))
    .maybeSingle();

  if (
    !data ||
    data.revoked_at ||
    new Date(data.expires_at).getTime() <= Date.now() ||
    data.resource !== options.resource
  )
    return null;

  const connection = data.mcp_oauth_connections;
  if (!connection || connection.status !== 'active' || connection.revoked_at) return null;

  void oauthDb()
    .from('oauth_access_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return {
    kind: 'oauth',
    connectionId: connection.id,
    ownerWallet: data.owner_wallet,
    clientId: data.client_id,
    clientName: connection.client_name,
    scopes: data.scopes ?? [],
    selectedAgentId: connection.selected_agent_id ?? null,
    policy: connection.policy_json ?? {},
  };
}

export const MCP_OAUTH_CHALLENGE =
  'Bearer resource_metadata="https://arclayers.xyz/.well-known/oauth-protected-resource"';

/**
 * Derive MCP scopes from legacy session permissions.
 * Maps allowedContracts/allowedActions to explicit MCP scopes.
 */
function deriveScopesFromPermissions(
  permissions?: Record<string, unknown>,
): string[] {
  if (!permissions) return [];

  const allowedContracts = permissions.allowedContracts as string[] | undefined;
  const allowedActions = permissions.allowedActions as string[] | undefined;
  const scopes = new Set<string>();

  // Always grant read access
  scopes.add('arclayer:read');

  // Map allowedContracts to scopes
  if (Array.isArray(allowedContracts)) {
    for (const contract of allowedContracts) {
      switch (contract) {
        case 'ERC8004_IDENTITY_REGISTRY':
          scopes.add('tx:request');
          break;
        case 'ERC8183_AGENTIC_COMMERCE':
          scopes.add('jobs:prepare');
          break;
        case 'ERC8004_REPUTATION_REGISTRY':
          scopes.add('tx:request');
          break;
        case 'ERC8004_VALIDATION_REGISTRY':
          scopes.add('tx:request');
          break;
      }
    }
  }

  // Map allowedActions to scopes
  if (Array.isArray(allowedActions)) {
    for (const action of allowedActions) {
      switch (action) {
        case 'identity.register':
          scopes.add('tx:request');
          break;
        case 'jobs.create':
        case 'jobs.fund':
        case 'jobs.submit':
        case 'jobs.complete':
        case 'jobs.reject':
          scopes.add('jobs:prepare');
          break;
        case 'provider.runtime':
          scopes.add('provider:runtime');
          break;
      }
    }
  }

  return Array.from(scopes);
}
