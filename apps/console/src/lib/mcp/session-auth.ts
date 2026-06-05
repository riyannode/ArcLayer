/**
 * MCP Session — Auth middleware for MCP API routes.
 *
 * Extracts MCP session token from Authorization: Bearer header only.
 * Query param auth is NOT allowed (tokens must not leak in URLs/logs).
 *
 * Two auth layers:
 * 1. Wallet session (cookie) — for session management routes (create/list/revoke)
 * 2. MCP session token (bearer) — for MCP tool invocation routes
 */

import type { NextRequest } from 'next/server';
import { resolveSessionFromCookie, SESSION_COOKIE_NAME } from '@/lib/auth/wallet-session';
import { resolveMcpSessionByToken } from '@/lib/agent-accounts/store';
import type { McpSession } from '@/lib/agent-accounts/types';

// ── Types ─────────────────────────────────────────────────────────────────

export interface McpAuthResult {
  authenticated: true;
  session: McpSession;
}

export interface McpAuthFailure {
  authenticated: false;
  error: string;
  status: number;
}

export type McpAuthResponse = McpAuthResult | McpAuthFailure;

export interface WalletAuthResult {
  authenticated: true;
  wallet: `0x${string}`;
}

export interface WalletAuthFailure {
  authenticated: false;
  error: string;
  status: number;
}

export type WalletAuthResponse = WalletAuthResult | WalletAuthFailure;

// ── MCP token extraction ──────────────────────────────────────────────────

const TOKEN_PREFIX = 'arc_mcp_sess_';

/**
 * Extract MCP session token from request.
 * Only accepted via Authorization: Bearer header.
 * Query param auth is NOT allowed (tokens must not leak in URLs/logs).
 */
function extractMcpToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1].startsWith(TOKEN_PREFIX)) {
      return match[1].trim();
    }
  }
  return null;
}

// ── Auth helpers ──────────────────────────────────────────────────────────

/**
 * Authenticate an MCP request using the MCP session token.
 * Returns the resolved session or an auth failure.
 */
export async function authenticateMcpRequest(
  req: NextRequest,
): Promise<McpAuthResponse> {
  const token = extractMcpToken(req);
  if (!token) {
    return { authenticated: false, error: 'missing_mcp_token', status: 401 };
  }

  const session = await resolveMcpSessionByToken(token);
  if (!session) {
    return { authenticated: false, error: 'invalid_or_expired_session', status: 401 };
  }

  return { authenticated: true, session };
}

/**
 * Authenticate a request using the wallet session cookie.
 * Used for session management routes (create/list/revoke).
 */
export async function authenticateWalletRequest(
  req: NextRequest,
): Promise<WalletAuthResponse> {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return { authenticated: false, error: 'missing_wallet_session', status: 401 };
  }

  const session = await resolveSessionFromCookie(cookieValue);
  if (!session) {
    return { authenticated: false, error: 'invalid_wallet_session', status: 401 };
  }

  return { authenticated: true, wallet: session.wallet };
}
