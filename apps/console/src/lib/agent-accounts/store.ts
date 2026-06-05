/**
 * Agent Account + MCP Session — Supabase store.
 *
 * Data access layer for arclayer_agent_accounts and mcp_sessions tables.
 * Uses getSupabaseAdmin() (service_role, bypasses RLS).
 *
 * Token security: raw token returned once on create; only sha256(token) stored.
 * Same pattern as wallet-session.ts.
 */

import { createHash, randomBytes } from 'node:crypto';
import { getAddress, isAddress } from 'viem';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import type {
  AgentAccount,
  UpsertAgentAccountParams,
  McpSession,
  McpSessionPermissions,
  CreateMcpSessionParams,
  McpSessionCreated,
} from './types';

// ── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_PREFIX = 'arc_mcp_sess_';

// ── Helpers ───────────────────────────────────────────────────────────────

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function ttlIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/**
 * Normalize Ethereum address to EIP-55 checksum form.
 * Throws if invalid.
 */
export function normalizeAddress(address: string): string {
  if (!isAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }
  return getAddress(address);
}

// ── Agent Account store ───────────────────────────────────────────────────

/**
 * Create or update an agent account binding for an owner.
 * If an active binding already exists for this owner, updates the agent account address.
 * Previous active bindings are soft-deactivated (status → 'disabled').
 */
export async function upsertAgentAccountForOwner(
  params: UpsertAgentAccountParams,
): Promise<AgentAccount> {
  const owner = normalizeAddress(params.ownerAddress);
  const agentAccount = normalizeAddress(params.agentAccountAddress);
  const supabase = getSupabaseAdmin();
  const now = nowIso();

  // Deactivate any existing active binding for this owner
  const { error: deactivateError } = await supabase
    .from('arclayer_agent_accounts')
    .update({ status: 'disabled', updated_at: now })
    .eq('owner_address', owner.toLowerCase())
    .eq('status', 'active');

  if (deactivateError) {
    throw new Error(`agent_account_deactivate_failed: ${deactivateError.message}`);
  }

  // Insert new active binding
  const row = {
    owner_address: owner.toLowerCase(),
    agent_account_address: agentAccount.toLowerCase(),
    wallet_provider: params.walletProvider ?? 'circle_modular',
    account_type: params.accountType ?? 'circle_smart_account',
    chain_id: params.chainId ?? 5042002,
    status: 'active',
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('arclayer_agent_accounts')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    throw new Error(`agent_account_insert_failed: ${error.message}`);
  }

  return mapAgentAccountRow(data as Record<string, unknown>);
}

/**
 * Get all agent accounts for an owner (active + disabled).
 * Ordered by most recently updated first.
 */
export async function getAgentAccountsForOwner(
  ownerAddress: string,
): Promise<AgentAccount[]> {
  const owner = normalizeAddress(ownerAddress);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('arclayer_agent_accounts')
    .select('*')
    .eq('owner_address', owner.toLowerCase())
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`agent_account_list_failed: ${error.message}`);
  }

  return ((data as unknown as Record<string, unknown>[]) ?? []).map(mapAgentAccountRow);
}

/**
 * Get the active agent account for an owner.
 * Returns null if no active binding exists.
 */
export async function getActiveAgentAccountForOwner(
  ownerAddress: string,
): Promise<AgentAccount | null> {
  const owner = normalizeAddress(ownerAddress);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('arclayer_agent_accounts')
    .select('*')
    .eq('owner_address', owner.toLowerCase())
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) return null;
  return mapAgentAccountRow(data as Record<string, unknown>);
}

/**
 * Get agent account by its address.
 * Returns null if not found.
 */
export async function getAgentAccountByAddress(
  agentAccountAddress: string,
): Promise<AgentAccount | null> {
  const addr = normalizeAddress(agentAccountAddress);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('arclayer_agent_accounts')
    .select('*')
    .eq('agent_account_address', addr.toLowerCase())
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) return null;
  return mapAgentAccountRow(data as Record<string, unknown>);
}

// ── MCP Session store ─────────────────────────────────────────────────────

/**
 * Create a new MCP session.
 * Returns the raw token (caller must return it to the user — never stored).
 * Only sha256(token) is persisted.
 */
export async function createMcpSession(
  params: CreateMcpSessionParams,
): Promise<McpSessionCreated> {
  const owner = normalizeAddress(params.ownerAddress);
  const agentAccount = normalizeAddress(params.agentAccountAddress);
  const supabase = getSupabaseAdmin();
  const now = nowIso();

  // Generate token: prefix + 32 random bytes (hex)
  const rawToken = TOKEN_PREFIX + randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(rawToken);

  const rawTtlMs = params.expiresInMs ?? DEFAULT_SESSION_TTL_MS;
  const ttlMs = Math.max(1, Math.min(MAX_SESSION_TTL_MS, rawTtlMs));
  const expiresAt = ttlIso(ttlMs);

  const permissions: McpSessionPermissions = params.permissions ?? {};
  const autoApprove = params.autoApprove ?? false;

  const { data, error } = await supabase
    .from('mcp_sessions')
    .insert({
      token_hash: tokenHash,
      owner_address: owner.toLowerCase(),
      agent_account_address: agentAccount.toLowerCase(),
      permissions_json: permissions,
      auto_approve: autoApprove,
      expires_at: expiresAt,
      created_at: now,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`mcp_session_create_failed: ${error.message}`);
  }

  return {
    session: mapMcpSessionRow(data as Record<string, unknown>),
    token: rawToken,
  };
}

/**
 * Resolve an MCP session by its raw token.
 * Verifies hash, checks expiry, checks revoked.
 * Updates last_used_at (fire-and-forget).
 * Returns null if invalid, expired, or revoked.
 */
export async function resolveMcpSessionByToken(
  token: string,
): Promise<McpSession | null> {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;

  const tokenHash = sha256Hex(token);
  const supabase = getSupabaseAdmin();

  const { data: row, error } = await supabase
    .from('mcp_sessions')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !row) return null;

  // Check expiry
  if (new Date((row as Record<string, unknown>).expires_at as string).getTime() < Date.now()) {
    return null;
  }

  // Check revoked
  if ((row as Record<string, unknown>).revoked_at) return null;

  // Update last_used_at (fire-and-forget)
  supabase
    .from('mcp_sessions')
    .update({ last_used_at: nowIso() })
    .eq('token_hash', tokenHash)
    .then(() => {}); // eslint-disable-line @typescript-eslint/no-empty-function

  return mapMcpSessionRow(row as Record<string, unknown>);
}

/**
 * List all MCP sessions for an owner (active, expired, and revoked).
 * Ordered by most recently created first.
 * Use .status field on each session to distinguish active/expired/revoked.
 */
export async function listMcpSessionsForOwner(
  ownerAddress: string,
): Promise<McpSession[]> {
  const owner = normalizeAddress(ownerAddress);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('mcp_sessions')
    .select('*')
    .eq('owner_address', owner.toLowerCase())
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`mcp_session_list_failed: ${error.message}`);
  }

  return ((data as unknown as Record<string, unknown>[]) ?? []).map(mapMcpSessionRow);
}

/**
 * Revoke an MCP session (soft delete).
 * Only the owner can revoke their own sessions.
 * Returns true only when it actually updates a row owned by the wallet.
 */
export async function revokeMcpSession(
  sessionId: string,
  ownerAddress: string,
): Promise<boolean> {
  const owner = normalizeAddress(ownerAddress);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('mcp_sessions')
    .update({ revoked_at: nowIso() })
    .eq('id', sessionId)
    .eq('owner_address', owner.toLowerCase())
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  // Only true if a row was actually updated
  return !error && data !== null;
}

/**
 * Revoke ALL MCP sessions for an owner.
 * Returns the number of sessions revoked.
 */
export async function revokeAllMcpSessionsForOwner(
  ownerAddress: string,
): Promise<number> {
  const owner = normalizeAddress(ownerAddress);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('mcp_sessions')
    .update({ revoked_at: nowIso() })
    .eq('owner_address', owner.toLowerCase())
    .is('revoked_at', null)
    .select('id');

  if (error) return 0;
  return (data as unknown as Record<string, unknown>[])?.length ?? 0;
}

// ── Row mappers ───────────────────────────────────────────────────────────

function mapAgentAccountRow(row: Record<string, unknown>): AgentAccount {
  return {
    id: String(row.id),
    ownerAddress: String(row.owner_address),
    agentAccountAddress: String(row.agent_account_address),
    walletProvider: String(row.wallet_provider ?? 'circle_modular'),
    accountType: String(row.account_type ?? 'circle_smart_account'),
    chainId: Number(row.chain_id ?? 5042002),
    status: String(row.status ?? 'active') as AgentAccount['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMcpSessionRow(row: Record<string, unknown>): McpSession {
  const revokedAt = row.revoked_at ? String(row.revoked_at) : null;
  const expiresAt = String(row.expires_at);

  // Compute status: revoked > expired > active
  let status: 'active' | 'expired' | 'revoked' = 'active';
  if (revokedAt) {
    status = 'revoked';
  } else if (new Date(expiresAt).getTime() < Date.now()) {
    status = 'expired';
  }

  return {
    id: String(row.id),
    tokenHash: String(row.token_hash),
    ownerAddress: String(row.owner_address),
    agentAccountAddress: String(row.agent_account_address),
    permissions: (row.permissions_json ?? {}) as McpSessionPermissions,
    autoApprove: Boolean(row.auto_approve),
    expiresAt,
    revokedAt,
    createdAt: String(row.created_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    status,
  };
}
