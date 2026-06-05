/**
 * MCP API Key Tools — Create, list, and revoke API keys via MCP.
 *
 * PR #456: provider.create_api_key, provider.list_api_keys, provider.revoke_api_key.
 *
 * Ownership model:
 * - MCP session has ownerAddress (EOA) and agentAccountAddress (Circle Smart Account).
 * - Agent's on-chain controller can be either:
 *   (a) ownerAddress (legacy EOA-minted agents)
 *   (b) agentAccountAddress (new Circle Agent Account-minted agents)
 * - We resolve the agent from the indexer, then check controller matches.
 * - We do NOT trust user-provided controller addresses.
 */

import {
  createApiKey,
  revokeApiKey,
  API_KEY_SCOPES,
} from '@/lib/a2a/auth';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import {
  resolveMcpSessionByToken,
  getActiveAgentAccountForOwnerAndAddress,
} from '@/lib/agent-accounts/store';
import type { McpSession } from '@/lib/agent-accounts/types';
import type { McpToolContext } from './registry';
import { MCP_ERRORS, McpError } from './errors';

// ── Constants ─────────────────────────────────────────────────────────────

const SCOPE_PRESETS: Record<string, string[]> = {
  provider: [
    API_KEY_SCOPES.ERC8183_CLAIM,
    API_KEY_SCOPES.ERC8183_RUNNING,
    API_KEY_SCOPES.ERC8183_SUBMIT,
    API_KEY_SCOPES.ERC8183_TX,
    API_KEY_SCOPES.ERC8183_PRESENCE,
  ],
  client: [
    API_KEY_SCOPES.ERC8183_CREATE,
    API_KEY_SCOPES.ERC8183_CONFIRM,
    API_KEY_SCOPES.ERC8183_TX,
    API_KEY_SCOPES.ERC8183_PRESENCE,
  ],
};

const ALLOWED_PRESETS = new Set(Object.keys(SCOPE_PRESETS));

const ENV_SNIPPETS: Record<string, string> = {
  provider: [
    'ARCLAYER_API_KEY=',
    'ARCLAYER_AGENT_ID=',
    'ARCLAYER_BASE_URL=https://arclayers.xyz',
    'ARCLAYER_MODE=provider',
  ].join('\n'),
  client: [
    'ARCLAYER_API_KEY=',
    'ARCLAYER_AGENT_ID=',
    'ARCLAYER_BASE_URL=https://arclayers.xyz',
    'ARCLAYER_MODE=client',
  ].join('\n'),
};

const INSTALL_COMMANDS: Record<string, string> = {
  provider: 'curl -fsSL https://arclayers.xyz/install/erc8183-provider.sh | bash',
  client: 'curl -fsSL https://arclayers.xyz/install/erc8183-client.sh | bash',
};

// ── Session auth helper ───────────────────────────────────────────────────

/**
 * Extract and validate MCP session from tool context.
 * Throws McpError if not authenticated.
 */
async function requireMcpSession(ctx: McpToolContext): Promise<McpSession> {
  const auth = ctx.request.authorization;
  if (!auth) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'MCP Bearer token required');
  }

  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].startsWith('arc_mcp_sess_')) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Invalid MCP token format');
  }

  const session = await resolveMcpSessionByToken(match[1].trim());
  if (!session) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Invalid or expired MCP session');
  }

  return session;
}

// ── Shared ownership helper ───────────────────────────────────────────────

/**
 * Verify that the MCP session owner controls the given agent.
 *
 * Checks:
 * 1. Agent must exist in erc8004_agents table (by agent_id or token_id).
 * 2. Agent's controller must match either:
 *    - session.ownerAddress (legacy EOA-minted agents), OR
 *    - session.agentAccountAddress (Circle Agent Account-minted agents)
 * 3. If agent is controlled by Agent Account, the binding must still be active.
 *
 * Returns the resolved agent row or throws McpError.
 */
export async function resolveAgentOwnership(
  session: McpSession,
  agentId: string,
): Promise<Record<string, unknown>> {
  const supabase = getSupabaseAdmin();

  // Find agent by agent_id or token_id
  const { data: agents, error } = await supabase
    .from('erc8004_agents')
    .select('*')
    .or(`agent_id.eq.${agentId},token_id.eq.${agentId}`)
    .limit(1);

  if (error) {
    throw new McpError(MCP_ERRORS.INTERNAL_ERROR, `DB query failed: ${error.message}`);
  }

  const agent = agents?.[0];
  if (!agent) {
    throw new McpError(MCP_ERRORS.NOT_FOUND, `Agent not found: ${agentId}`);
  }

  const controller = String(agent.controller || '').toLowerCase();
  const ownerAddr = session.ownerAddress.toLowerCase();
  const agentAccountAddr = session.agentAccountAddress?.toLowerCase();

  // Check if controller matches owner EOA (legacy agents)
  if (controller === ownerAddr) {
    return agent;
  }

  // Check if controller matches Agent Account (new agents)
  if (agentAccountAddr && controller === agentAccountAddr) {
    // Validate Agent Account binding is still active
    const account = await getActiveAgentAccountForOwnerAndAddress(
      session.ownerAddress,
      session.agentAccountAddress,
    );
    if (!account) {
      throw new McpError(
        MCP_ERRORS.FORBIDDEN,
        'agent_account_inactive — Agent Account binding is no longer active',
      );
    }
    return agent;
  }

  throw new McpError(
    MCP_ERRORS.FORBIDDEN,
    `Session does not control agent ${agentId}. Controller: ${controller}`,
  );
}

// ── Tool implementations ──────────────────────────────────────────────────

/**
 * provider.create_api_key — Create an API key for an agent.
 *
 * Args:
 *   agentId (required) — Agent ID or token ID.
 *   preset (optional, default "provider") — "provider" or "client".
 *   label (optional) — Human-readable label.
 *
 * Returns raw key ONCE. Never stored or returned again.
 */
export async function handleCreateApiKey(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);

  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  if (!agentId) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId is required');
  }

  const preset = typeof args.preset === 'string' ? args.preset.trim().toLowerCase() : 'provider';

  // Reject evaluator/worker/unknown presets
  if (!ALLOWED_PRESETS.has(preset)) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      `Invalid preset: "${preset}". Allowed: ${[...ALLOWED_PRESETS].join(', ')}. Evaluator will be added later.`,
    );
  }

  let label: string | undefined;
  if (args.label !== undefined && args.label !== null) {
    if (typeof args.label !== 'string') {
      throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'label must be a string');
    }
    const trimmed = args.label.trim();
    if (trimmed.length > 80) {
      throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'label must be 80 characters or fewer');
    }
    if (trimmed.length > 0) label = trimmed;
  }

  // Verify ownership
  const agent = await resolveAgentOwnership(session, agentId);
  const resolvedAgentId = String(agent.agent_id || agent.token_id || agentId);

  // Create the API key
  const result = await createApiKey({
    agentId: resolvedAgentId,
    label,
    scopes: SCOPE_PRESETS[preset],
    createdBy: session.ownerAddress,
  });

  if (!result.ok) {
    throw new McpError(MCP_ERRORS.INTERNAL_ERROR, `Failed to create API key: ${result.error}`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'https://arclayers.xyz';

  return {
    ok: true,
    agentId: resolvedAgentId,
    id: result.id,
    keyPrefix: result.keyPrefix,
    key: result.key, // raw key — shown once only
    scopes: SCOPE_PRESETS[preset],
    preset,
    envSnippet: ENV_SNIPPETS[preset],
    installCommand: INSTALL_COMMANDS[preset],
    warning: 'Store the key now — it will NOT be shown again. Use envSnippet to configure your PM2 bot.',
  };
}

/**
 * provider.list_api_keys — List API key metadata for an agent.
 *
 * Args:
 *   agentId (required) — Agent ID or token ID.
 *
 * Returns metadata only. Never returns raw key or key hash.
 */
export async function handleListApiKeys(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);

  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  if (!agentId) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId is required');
  }

  // Verify ownership
  const agent = await resolveAgentOwnership(session, agentId);
  const resolvedAgentId = String(agent.agent_id || agent.token_id || agentId);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('a2a_api_keys')
    .select('id, key_prefix, label, scopes, created_at, last_used_at, revoked_at')
    .eq('agent_id', resolvedAgentId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new McpError(MCP_ERRORS.INTERNAL_ERROR, `DB query failed: ${error.message}`);
  }

  const keys = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    keyPrefix: row.key_prefix,
    label: row.label,
    scopes: row.scopes ?? [],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    status: row.revoked_at ? 'revoked' : 'active',
  }));

  return {
    ok: true,
    agentId: resolvedAgentId,
    keys,
    total: keys.length,
  };
}

/**
 * provider.revoke_api_key — Revoke an API key.
 *
 * Args:
 *   agentId (required) — Agent ID or token ID.
 *   keyId (required) — API key ID to revoke.
 *
 * Returns ok + revoked status.
 */
export async function handleRevokeApiKey(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);

  const agentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
  if (!agentId) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'agentId is required');
  }

  const keyId = typeof args.keyId === 'string' ? args.keyId.trim() : '';
  if (!keyId) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'keyId is required');
  }

  // Verify ownership
  const agent = await resolveAgentOwnership(session, agentId);
  const resolvedAgentId = String(agent.agent_id || agent.token_id || agentId);

  const success = await revokeApiKey(keyId, resolvedAgentId);
  if (!success) {
    throw new McpError(
      MCP_ERRORS.NOT_FOUND,
      'Key not found or already revoked',
    );
  }

  return {
    ok: true,
    agentId: resolvedAgentId,
    keyId,
    revoked: true,
  };
}
