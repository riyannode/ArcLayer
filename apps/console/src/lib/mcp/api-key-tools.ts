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

import { getAddress } from 'viem';
import {
  createApiKey,
  revokeApiKey,
} from '@/lib/a2a/auth';
import { getERC8004OwnerOf } from '@/lib/contracts/erc8004';
import { isAgentAccountServerRailEnabled } from '@/lib/agent-accounts/feature-flags';
import { API_KEY_PRESETS, buildApiKeyEnvSnippet } from '@/lib/agent-onboarding/api-key-presets';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import {
  resolveMcpSessionByToken,
  getActiveAgentAccountForOwnerAndAddress,
} from '@/lib/agent-accounts/store';
import type { McpSession } from '@/lib/agent-accounts/types';
import type { McpToolContext } from './registry';
import { MCP_ERRORS, McpError } from './errors';
import { authAsLegacySession } from './auth-session';

// ── Constants ─────────────────────────────────────────────────────────────

const SCOPE_PRESETS = Object.fromEntries(
  Object.entries(API_KEY_PRESETS)
    .filter(([id]) => id === 'provider' || id === 'client')
    .map(([id, preset]) => [id, preset.scopes]),
) as Record<string, string[]>;

const PROVIDER_LIKE_ROLE_PRESETS = new Set([
  'provider',
  'smart-contract',
  'frontend',
  'backend',
  'devops',
  'design',
  'data-research',
  'documentation',
  'analysis',
  'payment',
]);
const CLIENT_ROLE_PRESETS = new Set(['client']);
const EVALUATOR_ROLE_PRESETS = new Set(['evaluator']);
const ACCEPTED_ROLE_PRESETS = new Set([
  ...PROVIDER_LIKE_ROLE_PRESETS,
  ...CLIENT_ROLE_PRESETS,
  ...EVALUATOR_ROLE_PRESETS,
]);

const INSTALL_COMMANDS = Object.fromEntries(
  Object.entries(API_KEY_PRESETS).map(([id, preset]) => [id, preset.installCommand]),
) as Record<string, string>;

// ── Input validation ──────────────────────────────────────────────────────

/**
 * Strict agent ID validation.
 * Must be a numeric token ID (digits only) or a short alphanumeric agent ID.
 * Rejects anything with special characters, spaces, or injection patterns.
 */
function isValidAgentId(id: string): boolean {
  if (!id || id.length > 128) return false;
  // Numeric token ID (e.g. "36191") or alphanumeric agent ID (e.g. "abc123")
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// ── Session auth helper ───────────────────────────────────────────────────

/**
 * Extract and validate MCP session from tool context.
 * Throws McpError if not authenticated.
 */
async function requireMcpSession(ctx: McpToolContext): Promise<McpSession> {
  if (ctx.auth) return authAsLegacySession(ctx.auth);
  const auth = ctx.request.authorization;
  const match = auth?.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].startsWith('arc_mcp_sess_')) throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'MCP Bearer token required');
  const session = await resolveMcpSessionByToken(match[1].trim());
  if (!session) throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Invalid or expired MCP session');
  return session;
}


async function sessionControlsController(
  session: McpSession,
  controllerAddress: string,
): Promise<boolean> {
  const controller = controllerAddress.toLowerCase();
  const ownerAddr = session.ownerAddress.toLowerCase();
  const agentAccountAddr = session.agentAccountAddress?.toLowerCase();

  if (controller === ownerAddr) return true;

  if (isAgentAccountServerRailEnabled() && agentAccountAddr && controller === agentAccountAddr) {
    const account = await getActiveAgentAccountForOwnerAndAddress(
      session.ownerAddress,
      session.agentAccountAddress,
    );

    return Boolean(account);
  }

  return false;
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
  // Strict input validation — reject injection patterns
  if (!isValidAgentId(agentId)) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      'agentId must be alphanumeric (digits, letters, hyphens, underscores), max 128 chars',
    );
  }

  const supabase = getSupabaseAdmin();

  // Two separate queries instead of .or() interpolation to avoid injection
  const [byAgentId, byTokenId] = await Promise.all([
    supabase
      .from('erc8004_agents')
      .select('*')
      .eq('agent_id', agentId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('erc8004_agents')
      .select('*')
      .eq('token_id', agentId)
      .limit(1)
      .maybeSingle(),
  ]);

  if (byAgentId.error && byTokenId.error) {
    throw new McpError(
      MCP_ERRORS.INTERNAL_ERROR,
      `DB query failed: ${byAgentId.error.message}`,
    );
  }

  const agent = byAgentId.data ?? byTokenId.data;
  if (!agent) {
    if (!/^\d+$/.test(agentId)) {
      throw new McpError(MCP_ERRORS.NOT_FOUND, `Agent not found: ${agentId}`);
    }

    let onchainOwner: string;
    try {
      onchainOwner = getAddress(await getERC8004OwnerOf(agentId)).toLowerCase();
    } catch {
      throw new McpError(MCP_ERRORS.NOT_FOUND, `Agent not found: ${agentId}`);
    }

    const controls = await sessionControlsController(session, onchainOwner);
    if (!controls) {
      throw new McpError(
        MCP_ERRORS.FORBIDDEN,
        `Session does not control agent ${agentId}. Controller: ${onchainOwner}`,
      );
    }

    return {
      agent_id: agentId,
      token_id: agentId,
      controller: onchainOwner,
      source: 'onchain_owner_fallback',
    };
  }

  const controller = String(agent.controller || '').toLowerCase();
  const controls = await sessionControlsController(session, controller);
  if (controls) return agent;

  throw new McpError(
    MCP_ERRORS.FORBIDDEN,
    `Session does not control agent ${agentId}. Controller: ${controller}`,
  );
}


function resolveApiKeyPresetForMcp(rawPreset: string): { requestedPreset: string; apiKeyPreset: 'provider' | 'client' } {
  const preset = rawPreset.trim().toLowerCase() || 'provider';
  if (PROVIDER_LIKE_ROLE_PRESETS.has(preset)) return { requestedPreset: preset, apiKeyPreset: 'provider' };
  if (CLIENT_ROLE_PRESETS.has(preset)) return { requestedPreset: preset, apiKeyPreset: 'client' };
  if (EVALUATOR_ROLE_PRESETS.has(preset)) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      'Evaluator API-key preset is not supported yet. Use provider/client role presets until evaluator API-key scope is implemented.',
    );
  }
  throw new McpError(
    MCP_ERRORS.VALIDATION_ERROR,
    `Invalid preset: "${preset}". Accepted role presets: ${[...ACCEPTED_ROLE_PRESETS].join(', ')}. Evaluator is listed but currently unsupported for API keys.`,
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

  const requestedPreset = typeof args.preset === 'string' ? args.preset.trim().toLowerCase() : 'provider';
  const { apiKeyPreset } = resolveApiKeyPresetForMcp(requestedPreset);

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
    scopes: SCOPE_PRESETS[apiKeyPreset],
    createdBy: session.ownerAddress,
  });

  if (!result.ok) {
    throw new McpError(MCP_ERRORS.INTERNAL_ERROR, `Failed to create API key: ${result.error}`);
  }

  const envSnippet = buildApiKeyEnvSnippet({ key: result.key, agentId: resolvedAgentId, preset: apiKeyPreset });

  return {
    ok: true,
    agentId: resolvedAgentId,
    id: result.id,
    keyPrefix: result.keyPrefix,
    key: result.key, // raw key — shown once only
    scopes: SCOPE_PRESETS[apiKeyPreset],
    preset: apiKeyPreset,
    requestedPreset: requestedPreset || 'provider',
    envSnippet,
    installCommand: INSTALL_COMMANDS[apiKeyPreset],
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
