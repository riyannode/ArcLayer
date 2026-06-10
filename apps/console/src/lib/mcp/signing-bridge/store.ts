/**
 * MCP Signing Bridge — Supabase Store.
 *
 * CRUD + atomic claim for signing sessions and requests.
 * All operations use Supabase admin client. No in-memory state.
 */

import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import {
  validateTransactions,
  validateChainId,
  type SigningTransaction,
  type SigningRequestSummary,
} from './whitelist';

// ── Types ─────────────────────────────────────────────────────────────────

export type SigningSessionStatus = 'active' | 'expired' | 'revoked';
export type SigningRequestStatus = 'pending' | 'signing' | 'submitted' | 'confirmed' | 'cancelled' | 'expired';

export interface McpSigningSession {
  id: string;
  pairing_code: string;
  owner_wallet: string;
  status: SigningSessionStatus;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export interface McpSigningRequest {
  id: string;
  session_id: string;
  action_type: string;
  chain_id: number;
  expected_client_wallet: string;
  transactions: SigningTransaction[];
  summary: SigningRequestSummary | null;
  result: Record<string, unknown> | null;
  status: SigningRequestStatus;
  claimed_by_session: string | null;
  tx_hash: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export type SigningRequestResult = {
  txHashes: string[];
  receipts: { txHash: string; blockNumber: string; gasUsed: string }[];
  jobId?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────

const SESSION_TTL_MINUTES = 30;
const REQUEST_TTL_MINUTES = 10;
const HEARTBEAT_EXTEND_MINUTES = 30;

// ── Helpers ───────────────────────────────────────────────────────────────

function generatePairingCode(): string {
  // 8-char alphanumeric, uppercase for readability
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for clarity
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function futureDate(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function supabase() {
  return getSupabaseAdmin();
}

// ── Session CRUD ──────────────────────────────────────────────────────────

/**
 * Create a new signing session for a wallet.
 * Auto-revokes any previous active sessions for the same wallet (max 1 active).
 */
export async function createSession(
  ownerWallet: string,
): Promise<McpSigningSession> {
  const db = supabase();
  const now = new Date().toISOString();

  // Revoke any existing active sessions for this wallet
  await db
    .from('mcp_signing_sessions')
    .update({ status: 'revoked' })
    .eq('owner_wallet', ownerWallet.toLowerCase())
    .eq('status', 'active');

  // Generate unique pairing code (retry on collision)
  let pairingCode = generatePairingCode();
  let attempts = 0;
  while (attempts < 5) {
    const { data: existing } = await db
      .from('mcp_signing_sessions')
      .select('id')
      .eq('pairing_code', pairingCode)
      .maybeSingle();
    if (!existing) break;
    pairingCode = generatePairingCode();
    attempts++;
  }

  const { data, error } = await db
    .from('mcp_signing_sessions')
    .insert({
      pairing_code: pairingCode,
      owner_wallet: ownerWallet.toLowerCase(),
      status: 'active',
      created_at: now,
      expires_at: futureDate(SESSION_TTL_MINUTES),
      last_seen_at: now,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create signing session: ${error?.message ?? 'unknown'}`);
  }

  return data as McpSigningSession;
}

/**
 * Get a session by ID. Returns null if not found.
 */
export async function getSession(sessionId: string): Promise<McpSigningSession | null> {
  const { data } = await supabase()
    .from('mcp_signing_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  return (data as McpSigningSession) ?? null;
}

/**
 * Get active session by ID. Returns null if not active or expired.
 */
export async function getActiveSession(sessionId: string): Promise<McpSigningSession | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  if (session.status !== 'active') return null;
  if (new Date(session.expires_at) < new Date()) return null;
  return session;
}


/** Find the active browser signing session for an owner wallet. */
export async function getActiveSessionForWallet(ownerWallet: string): Promise<McpSigningSession | null> {
  const now = new Date().toISOString();
  const { data } = await supabase()
    .from('mcp_signing_sessions')
    .select('*')
    .eq('owner_wallet', ownerWallet.toLowerCase())
    .eq('status', 'active')
    .gt('expires_at', now)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as McpSigningSession) ?? null;
}

/**
 * Heartbeat: update last_seen_at and extend expires_at.
 * Only works on active sessions.
 */
export async function heartbeatSession(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase()
    .from('mcp_signing_sessions')
    .update({
      last_seen_at: new Date().toISOString(),
      expires_at: futureDate(HEARTBEAT_EXTEND_MINUTES),
    })
    .eq('id', sessionId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();

  return !!data && !error;
}

/**
 * Revoke a session. Only works on active sessions.
 */
export async function revokeSession(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase()
    .from('mcp_signing_sessions')
    .update({ status: 'revoked' })
    .eq('id', sessionId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();

  return !!data && !error;
}

// ── Request CRUD ──────────────────────────────────────────────────────────

/**
 * Create a signing request for an active session.
 * Validates session is active, chain ID, and all transactions against whitelist.
 */
export async function createRequest(
  sessionId: string,
  actionType: string,
  chainId: number,
  expectedClientWallet: string,
  transactions: SigningTransaction[],
  summary?: SigningRequestSummary,
): Promise<McpSigningRequest> {
  // Validate session is active
  const session = await getActiveSession(sessionId);
  if (!session) {
    throw new Error('Session not found or not active');
  }

  // Derive expectedClientWallet from session if not provided
  const resolvedWallet = expectedClientWallet?.trim()
    ? expectedClientWallet.trim()
    : session.owner_wallet;

  // If wallet was explicitly provided, verify it matches session owner
  if (expectedClientWallet?.trim()) {
    if (expectedClientWallet.toLowerCase() !== session.owner_wallet.toLowerCase()) {
      throw new Error('expectedClientWallet does not match session owner_wallet');
    }
  }

  // Validate chain
  validateChainId(chainId);

  // Validate all transactions against whitelist
  validateTransactions(transactions);

  const now = new Date().toISOString();

  const { data, error } = await supabase()
    .from('mcp_signing_requests')
    .insert({
      session_id: sessionId,
      action_type: actionType,
      chain_id: chainId,
      expected_client_wallet: resolvedWallet.toLowerCase(),
      transactions,
      summary: summary ?? null,
      status: 'pending',
      expires_at: futureDate(REQUEST_TTL_MINUTES),
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create signing request: ${error?.message ?? 'unknown'}`);
  }

  return data as McpSigningRequest;
}

/**
 * Get pending requests for a session (for polling).
 * Only returns non-expired pending requests.
 */
export async function getPendingRequests(sessionId: string): Promise<McpSigningRequest[]> {
  const now = new Date().toISOString();

  const { data } = await supabase()
    .from('mcp_signing_requests')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'pending')
    .gt('expires_at', now)
    .order('created_at', { ascending: true });

  return (data ?? []) as McpSigningRequest[];
}

/**
 * Get a single request by ID.
 */
export async function getRequest(requestId: string): Promise<McpSigningRequest | null> {
  const { data } = await supabase()
    .from('mcp_signing_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  return (data as McpSigningRequest) ?? null;
}

/**
 * Atomic claim: move pending → signing.
 * Only one caller can win. Returns the claimed request or null if already claimed.
 *
 * Hardened conditions:
 * - status must be 'pending'
 * - expires_at must be > now (not expired)
 * - parent session must be active and not expired
 */
export async function claimRequest(
  requestId: string,
  sessionId: string,
): Promise<McpSigningRequest | null> {
  const now = new Date().toISOString();

  // Verify parent session is active and not expired
  const session = await getActiveSession(sessionId);
  if (!session) return null;

  const { data, error } = await supabase()
    .from('mcp_signing_requests')
    .update({
      status: 'signing',
      claimed_by_session: sessionId,
      updated_at: now,
    })
    .eq('id', requestId)
    .eq('session_id', sessionId)
    .eq('status', 'pending')
    .gt('expires_at', now)
    .select('*')
    .maybeSingle();

  if (error || !data) return null;
  return data as McpSigningRequest;
}

/**
 * Mark request as submitted (signing → submitted).
 * Stores primary tx hash.
 */
export async function markSubmitted(
  requestId: string,
  txHash: string,
): Promise<boolean> {
  const { data, error } = await supabase()
    .from('mcp_signing_requests')
    .update({
      status: 'submitted',
      tx_hash: txHash,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .in('status', ['signing'])
    .select('id')
    .maybeSingle();

  return !!data && !error;
}

/**
 * Mark request as confirmed (submitted → confirmed).
 * Stores result jsonb (txHashes, receipts, jobId).
 */
export async function markConfirmed(
  requestId: string,
  result: SigningRequestResult,
): Promise<boolean> {
  // Use first txHash as primary if not already set
  const primaryHash = result.txHashes[0] ?? null;

  const { data, error } = await supabase()
    .from('mcp_signing_requests')
    .update({
      status: 'confirmed',
      result,
      ...(primaryHash ? { tx_hash: primaryHash } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .in('status', ['submitted', 'signing'])
    .select('id')
    .maybeSingle();

  return !!data && !error;
}

/**
 * Cancel a request (pending → cancelled, or signing → cancelled).
 */
export async function cancelRequest(requestId: string): Promise<boolean> {
  const { data, error } = await supabase()
    .from('mcp_signing_requests')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .in('status', ['pending', 'signing'])
    .select('id')
    .maybeSingle();

  return !!data && !error;
}

/**
 * Expire stale requests: pending/signing requests past their expires_at.
 * Should be called periodically or before getPendingRequests.
 */
export async function expireStaleRequests(): Promise<number> {
  const now = new Date().toISOString();

  const { data, error } = await supabase()
    .from('mcp_signing_requests')
    .update({ status: 'expired', updated_at: now })
    .in('status', ['pending', 'signing'])
    .lt('expires_at', now)
    .select('id');

  if (error) return 0;
  return data?.length ?? 0;
}
