/**
 * MCP Session — Lifecycle helpers.
 *
 * Thin wrappers around the store that add validation, error handling,
 * and MCP-specific logic (token generation, expiry checks).
 *
 * The create route (POST /api/mcp/sessions/create) calls store functions
 * directly for the upsert + create flow. These helpers are for other
 * callers (tests, scripts, future internal use).
 */

import { isAddress, getAddress } from 'viem';
import {
  createMcpSession,
  resolveMcpSessionByToken,
  listMcpSessionsForOwner,
  revokeMcpSession,
  revokeAllMcpSessionsForOwner,
  upsertAgentAccountForOwner,
} from '@/lib/agent-accounts/store';
import type {
  McpSession,
  McpSessionCreated,
  McpSessionPermissions,
} from '@/lib/agent-accounts/types';

// ── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_PERMISSIONS: McpSessionPermissions = {
  scopes: [
    'arclayer:read',
    'agents:read',
    'jobs:read',
    'jobs:prepare',
    'provider:runtime',
    'tx:request',
  ],
  allowedContracts: ['ERC8004_IDENTITY_REGISTRY'],
  allowedActions: ['identity.register'],
};

// ── Session lifecycle ─────────────────────────────────────────────────────

/**
 * Create a new MCP session for an authenticated wallet owner.
 * Upserts the agent account binding, then creates the session.
 * autoApprove is forced false (PR 451 — approval engine in PR 452).
 * expiresInDays: default 30, max 30.
 */
export async function createSessionForOwner(params: {
  ownerAddress: string;
  agentAccountAddress: string;
  permissions?: McpSessionPermissions;
  expiresInDays?: number;
}): Promise<McpSessionCreated> {
  const { ownerAddress, agentAccountAddress, permissions, expiresInDays } = params;

  if (!isAddress(ownerAddress)) throw new Error('invalid_owner_address');
  if (!isAddress(agentAccountAddress)) throw new Error('invalid_agent_account_address');

  const normalizedOwner = getAddress(ownerAddress);
  const normalizedAgent = getAddress(agentAccountAddress);

  const MAX_DAYS = 30;
  const DEFAULT_DAYS = 30;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.min(MAX_DAYS, Math.floor(expiresInDays ?? DEFAULT_DAYS)));

  // Upsert agent account binding
  await upsertAgentAccountForOwner({
    ownerAddress: normalizedOwner,
    agentAccountAddress: normalizedAgent,
  });

  // Create session (autoApprove forced false)
  return createMcpSession({
    ownerAddress: normalizedOwner,
    agentAccountAddress: normalizedAgent,
    permissions: permissions ?? DEFAULT_PERMISSIONS,
    autoApprove: false,
    expiresInMs: days * MS_PER_DAY,
  });
}

/**
 * Resolve and validate an MCP session from a raw token.
 * Returns null if invalid, expired, or revoked.
 */
export async function resolveSession(token: string): Promise<McpSession | null> {
  return resolveMcpSessionByToken(token);
}

/**
 * List all MCP sessions for an owner (active, expired, revoked).
 */
export async function listSessionsForOwner(
  ownerAddress: string,
): Promise<McpSession[]> {
  if (!isAddress(ownerAddress)) return [];
  return listMcpSessionsForOwner(getAddress(ownerAddress));
}

/**
 * Revoke a specific MCP session.
 * Only the owner can revoke their own sessions.
 * Returns true only when a row was actually updated.
 */
export async function revokeSession(
  sessionId: string,
  ownerAddress: string,
): Promise<boolean> {
  if (!isAddress(ownerAddress)) return false;
  return revokeMcpSession(sessionId, getAddress(ownerAddress));
}

/**
 * Revoke all MCP sessions for an owner.
 */
export async function revokeAllSessionsForOwner(
  ownerAddress: string,
): Promise<number> {
  if (!isAddress(ownerAddress)) return 0;
  return revokeAllMcpSessionsForOwner(getAddress(ownerAddress));
}

/**
 * Check if a session has permission for a specific action.
 * Matches against allowedContracts and allowedActions in permissions.
 * Wildcard: '*' grants all. Empty/missing allow-list = DENY ALL.
 */
export function sessionHasPermission(
  session: McpSession,
  contract: string,
  action: string,
): boolean {
  const perms = session.permissions;
  if (!perms) return false;

  // Empty or missing allow-list = deny all
  const allowedContracts = perms.allowedContracts;
  if (!allowedContracts || allowedContracts.length === 0) return false;
  if (!allowedContracts.includes(contract) && !allowedContracts.includes('*')) {
    return false;
  }

  const allowedActions = perms.allowedActions;
  if (!allowedActions || allowedActions.length === 0) return false;
  if (!allowedActions.includes(action) && !allowedActions.includes('*')) {
    return false;
  }

  return true;
}
