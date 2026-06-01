/**
 * Wallet Session — Supabase-backed cookie session for external non-dev users.
 *
 * Flow:
 *   1. GET /api/auth/wallet/nonce?address=0x... → nonce + message
 *   2. Client signs message with EIP-191 personal_sign
 *   3. POST /api/auth/wallet/verify → verify sig, create DB session, set httpOnly cookie
 *   4. GET /api/auth/session → resolve session from cookie, return linked agents
 *   5. POST /api/auth/logout → revoke session, clear cookie
 *
 * Storage: Supabase (wallet_auth_nonces + wallet_sessions).
 * Cookie: HMAC-signed session token (createHmac).
 * Raw nonce returned once to client; DB stores sha256(nonce).
 * Raw cookie token never stored; DB stores sha256(sessionId).
 */

import { verifyMessage, isAddress, getAddress } from 'viem';
import { createHmac, createHash, randomBytes } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────

export interface NonceEntry {
  nonce_hash: string;
  controller: string;
  message: string;
  expires_at: string;
  used_at: string | null;
}

export interface SessionRow {
  id: string;
  session_hash: string;
  controller: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export interface WalletSession {
  sessionId: string;
  wallet: `0x${string}`;
  createdAt: number;
  expiresAt: number;
}

export interface NonceResponse {
  ok: true;
  address: string;
  nonce: string;
  message: string;
  expiresAt: number;
}

export interface VerifyResult {
  ok: true;
  session: WalletSession;
}

export interface VerifyError {
  ok: false;
  error: string;
  detail?: string;
}

export type VerifyResponse = VerifyResult | VerifyError;

export interface LinkedAgent {
  agentId: string;
  tokenId: string;
  controller: string;
  metadataName?: string;
}

export interface SessionStatus {
  authenticated: boolean;
  wallet?: `0x${string}`;
  expiresAt?: number;
  linkedAgents: LinkedAgent[];
}

// ── Constants ─────────────────────────────────────────────────────────────

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const SESSION_COOKIE_NAME = 'arclayer-wallet-session';

function getSessionSecret(): string {
  const env = process.env.WALLET_SESSION_SECRET;
  if (env) return env;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('WALLET_SESSION_SECRET is required in production');
  }
  return 'arclayer-dev-session-secret-change-in-prod';
}

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

// ── Signing helpers ───────────────────────────────────────────────────────

export function buildNonceSignMessage(wallet: string, nonce: string): string {
  return [
    'ArcLayer Wallet Session',
    '',
    `Wallet: ${getAddress(wallet)}`,
    `Nonce: ${nonce}`,
    '',
    'This signature proves wallet ownership and creates a browser session.',
  ].join('\n');
}

function signSessionId(sessionId: string): string {
  const secret = getSessionSecret();
  const hmac = createHmac('sha256', secret)
    .update(sessionId)
    .digest('hex');
  return `${sessionId}.${hmac}`;
}

export function verifySessionToken(token: string): string | null {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) return null;

  const sessionId = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);

  const secret = getSessionSecret();
  const expectedSig = createHmac('sha256', secret)
    .update(sessionId)
    .digest('hex');

  if (providedSig.length !== expectedSig.length) return null;
  let mismatch = 0;
  for (let i = 0; i < providedSig.length; i++) {
    mismatch |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  return sessionId;
}

// ── Supabase client ───────────────────────────────────────────────────────

async function getSupabase() {
  const { getSupabaseAdmin } = await import('@/lib/x402/supabaseClient');
  return getSupabaseAdmin();
}

// ── Core API ──────────────────────────────────────────────────────────────

/**
 * Generate a new nonce bound to a wallet address.
 * Stores sha256(nonce) in DB. Returns raw nonce + exact message to client.
 */
export async function generateNonce(address: string): Promise<NonceResponse | VerifyError> {
  if (!isAddress(address)) {
    return { ok: false, error: 'invalid_address', detail: 'Valid Ethereum address required' };
  }

  const normalized = getAddress(address);
  const nonce = randomBytes(32).toString('hex');
  const nonceHash = sha256Hex(nonce);
  const message = buildNonceSignMessage(normalized, nonce);
  const expiresAt = ttlIso(NONCE_TTL_MS);

  const supabase = await getSupabase();
  const { error } = await supabase.from('wallet_auth_nonces').insert({
    nonce_hash: nonceHash,
    controller: normalized.toLowerCase(),
    message,
    expires_at: expiresAt,
  });

  if (error) {
    return { ok: false, error: 'nonce_store_failed', detail: error.message };
  }

  return {
    ok: true,
    address: normalized,
    nonce,
    message,
    expiresAt: new Date(expiresAt).getTime(),
  };
}

/**
 * Verify a signed nonce and create a session.
 * Rejects if wallet doesn't match nonce-bound controller.
 */
export async function verifyAndCreateSession(params: {
  wallet: string;
  nonce: string;
  signature: string;
}): Promise<VerifyResponse & { cookieToken?: string }> {
  const { wallet, nonce, signature } = params;

  if (!isAddress(wallet)) {
    return { ok: false, error: 'invalid_wallet', detail: 'Invalid Ethereum address' };
  }

  const normalizedWallet = getAddress(wallet);

  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    return { ok: false, error: 'invalid_signature', detail: 'Signature must be 65-byte hex' };
  }

  const nonceHash = sha256Hex(nonce);
  const supabase = await getSupabase();

  // Lookup nonce by hash
  const { data: nonceRow, error: lookupError } = await supabase
    .from('wallet_auth_nonces')
    .select('*')
    .eq('nonce_hash', nonceHash)
    .maybeSingle();

  if (lookupError || !nonceRow) {
    return { ok: false, error: 'nonce_not_found', detail: 'Nonce not found' };
  }

  if (nonceRow.used_at) {
    return { ok: false, error: 'nonce_used', detail: 'Nonce already consumed (replay protection)' };
  }

  if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'nonce_expired', detail: 'Nonce expired (5min window)' };
  }

  // Wallet must match the controller bound to the nonce
  if (getAddress(nonceRow.controller) !== normalizedWallet) {
    return {
      ok: false,
      error: 'wallet_mismatch',
      detail: `Nonce was created for ${nonceRow.controller}, not ${normalizedWallet}`,
    };
  }

  // Verify signature over the stored message
  let valid = false;
  try {
    valid = await verifyMessage({
      address: normalizedWallet,
      message: nonceRow.message as string,
      signature: signature as `0x${string}`,
    });
  } catch {
    return { ok: false, error: 'verify_failed', detail: 'Signature verification threw' };
  }

  if (!valid) {
    return { ok: false, error: 'signature_invalid', detail: 'Signature does not recover to wallet' };
  }

  // Mark nonce used
  const { error: markError } = await supabase
    .from('wallet_auth_nonces')
    .update({ used_at: nowIso() })
    .eq('nonce_hash', nonceHash)
    .is('used_at', null);

  if (markError) {
    return { ok: false, error: 'nonce_consume_failed', detail: markError.message };
  }

  // Create session
  const sessionId = randomBytes(32).toString('hex');
  const sessionHash = sha256Hex(sessionId);
  const now = nowIso();
  const expiresAt = ttlIso(SESSION_TTL_MS);

  const { error: sessionError } = await supabase.from('wallet_sessions').insert({
    session_hash: sessionHash,
    controller: normalizedWallet.toLowerCase(),
    expires_at: expiresAt,
    created_at: now,
    last_seen_at: now,
  });

  if (sessionError) {
    return { ok: false, error: 'session_create_failed', detail: sessionError.message };
  }

  const cookieToken = signSessionId(sessionId);

  return {
    ok: true,
    session: {
      sessionId,
      wallet: normalizedWallet.toLowerCase() as `0x${string}`,
      createdAt: Date.now(),
      expiresAt: new Date(expiresAt).getTime(),
    },
    cookieToken,
  };
}

/**
 * Resolve a session from a cookie token.
 * Verifies HMAC, hashes sessionId, looks up in DB.
 */
export async function resolveSessionFromCookie(cookieValue: string): Promise<WalletSession | null> {
  const sessionId = verifySessionToken(cookieValue);
  if (!sessionId) return null;

  const sessionHash = sha256Hex(sessionId);
  const supabase = await getSupabase();

  const { data: row, error } = await supabase
    .from('wallet_sessions')
    .select('*')
    .eq('session_hash', sessionHash)
    .maybeSingle();

  if (error || !row) return null;

  // Check expiry
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }

  // Check revoked
  if (row.revoked_at) return null;

  // Update last_seen_at (fire-and-forget)
  supabase
    .from('wallet_sessions')
    .update({ last_seen_at: nowIso() })
    .eq('session_hash', sessionHash)
    .then(() => {}); // eslint-disable-line @typescript-eslint/no-empty-function

  return {
    sessionId,
    wallet: row.controller as `0x${string}`,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
  };
}

/**
 * Revoke a session (logout).
 */
export async function destroySession(cookieValue: string): Promise<boolean> {
  const sessionId = verifySessionToken(cookieValue);
  if (!sessionId) return false;

  const sessionHash = sha256Hex(sessionId);
  const supabase = await getSupabase();

  const { error } = await supabase
    .from('wallet_sessions')
    .update({ revoked_at: nowIso() })
    .eq('session_hash', sessionHash)
    .is('revoked_at', null);

  return !error;
}

// ── Cookie helpers ────────────────────────────────────────────────────────

export function buildSessionCookie(token: string, maxAgeSeconds = SESSION_TTL_MS / 1000): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ── Linked agents helper ─────────────────────────────────────────────────

export async function getLinkedErc8004AgentsForController(
  controller: string,
): Promise<LinkedAgent[]> {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from('erc8004_agents')
      .select('token_id, agent_id, controller, metadata_json')
      .eq('controller', controller.toLowerCase())
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error || !data) return [];

    return data.map((row: Record<string, unknown>) => ({
      agentId: String(row.agent_id ?? row.token_id ?? ''),
      tokenId: String(row.token_id ?? ''),
      controller: String(row.controller ?? ''),
      metadataName: (row.metadata_json as Record<string, unknown> | null)?.name as string | undefined,
    }));
  } catch {
    return [];
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────

/**
 * Create an in-memory Supabase mock for tests.
 * Returns { supabase, nonceRows, sessionRows } for assertions.
 */
export function createTestSupabaseMock() {
  const nonceRows: Record<string, unknown>[] = [];
  const sessionRows: Record<string, unknown>[] = [];

  function applyFilters(rows: Record<string, unknown>[], filters: Array<{ op: string; col: string; val: unknown }>) {
    return rows.filter((row) =>
      filters.every((f) => {
        const v = row[f.col];
        if (f.op === 'eq') return v === f.val;
        if (f.op === 'is') {
          // Supabase IS NULL matches both null and undefined (column not set)
          if (f.val === null) return v === null || v === undefined;
          return v !== null && v !== undefined;
        }
        return true;
      }),
    );
  }

  const supabase = {
    from: (table: string) => {
      if (table === 'wallet_auth_nonces') {
        return {
          insert: (row: Record<string, unknown>) => {
            nonceRows.push(row);
            return Promise.resolve({ data: null, error: null });
          },
          select: (_cols: string) => {
            const filters: Array<{ op: string; col: string; val: unknown }> = [];
            const chain: Record<string, unknown> = {
              eq: (col: string, val: unknown) => {
                filters.push({ op: 'eq', col, val });
                return chain;
              },
              is: (col: string, val: unknown) => {
                filters.push({ op: 'is', col, val });
                return chain;
              },
              maybeSingle: () => {
                const filtered = applyFilters(nonceRows, filters);
                return Promise.resolve({ data: filtered[0] ?? null, error: null });
              },
            };
            return chain;
          },
          update: (updates: Record<string, unknown>) => {
            const filters: Array<{ op: string; col: string; val: unknown }> = [];
            const chain: Record<string, unknown> = {
              eq: (col: string, val: unknown) => {
                filters.push({ op: 'eq', col, val });
                return chain;
              },
              is: (col: string, val: unknown) => {
                filters.push({ op: 'is', col, val });
                return chain;
              },
              then: (resolve: (v: unknown) => void) => {
                const filtered = applyFilters(nonceRows, filters);
                filtered.forEach((row) => Object.assign(row, updates));
                resolve({ data: null, error: null });
              },
            };
            return chain;
          },
        };
      }

      if (table === 'wallet_sessions') {
        return {
          insert: (row: Record<string, unknown>) => {
            sessionRows.push(row);
            return Promise.resolve({ data: null, error: null });
          },
          select: (_cols: string) => {
            const filters: Array<{ op: string; col: string; val: unknown }> = [];
            const chain: Record<string, unknown> = {
              eq: (col: string, val: unknown) => {
                filters.push({ op: 'eq', col, val });
                return chain;
              },
              is: (col: string, val: unknown) => {
                filters.push({ op: 'is', col, val });
                return chain;
              },
              maybeSingle: () => {
                const filtered = applyFilters(sessionRows, filters);
                return Promise.resolve({ data: filtered[0] ?? null, error: null });
              },
            };
            return chain;
          },
          update: (updates: Record<string, unknown>) => {
            const filters: Array<{ op: string; col: string; val: unknown }> = [];
            const chain: Record<string, unknown> = {
              eq: (col: string, val: unknown) => {
                filters.push({ op: 'eq', col, val });
                return chain;
              },
              is: (col: string, val: unknown) => {
                filters.push({ op: 'is', col, val });
                return chain;
              },
              then: (resolve: (v: unknown) => void) => {
                const filtered = applyFilters(sessionRows, filters);
                filtered.forEach((row) => Object.assign(row, updates));
                resolve({ data: null, error: null });
              },
            };
            return chain;
          },
        };
      }

      if (table === 'erc8004_agents') {
        return {
          select: (_cols: string) => {
            const chain: Record<string, unknown> = {
              eq: (_col: string, _val: unknown) => chain,
              order: () => chain,
              limit: () => Promise.resolve({ data: [], error: null }),
            };
            return chain;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { supabase, nonceRows, sessionRows };
}
