/**
 * Wallet Session — cookie-based session for external non-dev users.
 *
 * Flow:
 *   1. Client calls GET /api/auth/wallet/nonce → receives { nonce, expiresAt }
 *   2. Client signs the nonce with EIP-191 personal_sign
 *   3. Client calls POST /api/auth/wallet/verify with { wallet, signature, nonce }
 *   4. Server verifies signature, creates session, sets httpOnly cookie
 *   5. Subsequent requests read session from cookie via GET /api/auth/session
 *   6. Client calls POST /api/auth/logout to clear session
 *
 * Session is stored in-memory (per-instance). For multi-instance deployments,
 * swap SessionStore with a Redis/DB-backed implementation.
 */

import { verifyMessage, isAddress, getAddress } from 'viem';
import { createHash, randomBytes } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────

export interface NonceEntry {
  nonce: string;
  wallet: string; // lowercase 0x address, set after verify
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface WalletSession {
  sessionId: string;
  wallet: `0x${string}`;
  createdAt: number;
  expiresAt: number;
}

export interface NonceResponse {
  nonce: string;
  expiresAt: number;
  message: string; // the exact message the client must sign
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

export interface SessionStatus {
  authenticated: boolean;
  wallet?: `0x${string}`;
  expiresAt?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_NONCES = 5_000;
const MAX_SESSIONS = 10_000;
export const SESSION_COOKIE_NAME = 'arclayer-wallet-session';
const SESSION_SECRET = process.env.WALLET_SESSION_SECRET || 'arclayer-dev-session-secret-change-in-prod';

// ── In-memory stores ──────────────────────────────────────────────────────

const nonceStore = new Map<string, NonceEntry>();
const sessionStore = new Map<string, WalletSession>();

function pruneNonces(): void {
  if (nonceStore.size < MAX_NONCES) return;
  const now = Date.now();
  for (const [key, entry] of Array.from(nonceStore.entries())) {
    if (entry.expiresAt < now || entry.used) {
      nonceStore.delete(key);
    }
  }
}

function pruneSessions(): void {
  if (sessionStore.size < MAX_SESSIONS) return;
  const now = Date.now();
  for (const [key, session] of Array.from(sessionStore.entries())) {
    if (session.expiresAt < now) {
      sessionStore.delete(key);
    }
  }
}

// ── Signing helpers ───────────────────────────────────────────────────────

/**
 * Build the canonical message that the client must sign.
 * Uses a simple nonce-based message (not per-request method/path).
 */
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

/**
 * Create an HMAC-signed session token (sessionId.signature).
 * Uses SHA-256 as HMAC since Node crypto doesn't need external deps.
 */
function signSessionId(sessionId: string): string {
  const hmac = createHash('sha256')
    .update(`${SESSION_SECRET}:${sessionId}`)
    .digest('hex');
  return `${sessionId}.${hmac}`;
}

/**
 * Verify and extract sessionId from a signed token.
 * Returns null if invalid.
 */
export function verifySessionToken(token: string): string | null {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) return null;

  const sessionId = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);

  const expectedSig = createHash('sha256')
    .update(`${SESSION_SECRET}:${sessionId}`)
    .digest('hex');

  // Constant-time comparison
  if (providedSig.length !== expectedSig.length) return null;
  let mismatch = 0;
  for (let i = 0; i < providedSig.length; i++) {
    mismatch |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  return sessionId;
}

// ── Core API ──────────────────────────────────────────────────────────────

/**
 * Generate a new nonce for wallet signing.
 */
export function generateNonce(): NonceResponse {
  pruneNonces();

  const nonce = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + NONCE_TTL_MS;

  nonceStore.set(nonce, {
    nonce,
    wallet: '', // filled on verify
    createdAt: now,
    expiresAt,
    used: false,
  });

  return {
    nonce,
    expiresAt,
    message: '', // caller sets after determining wallet
  };
}

/**
 * Get the sign message for a nonce + wallet combination.
 */
export function getSignMessage(wallet: string, nonce: string): string {
  return buildNonceSignMessage(wallet, nonce);
}

/**
 * Verify a signed nonce and create a session.
 * Returns a session object and the signed cookie token.
 */
export async function verifyAndCreateSession(params: {
  wallet: string;
  nonce: string;
  signature: string;
}): Promise<VerifyResponse & { cookieToken?: string }> {
  const { wallet, nonce, signature } = params;

  // Validate wallet address
  if (!isAddress(wallet)) {
    return { ok: false, error: 'invalid_wallet', detail: 'Invalid Ethereum address' };
  }

  const normalizedWallet = getAddress(wallet);

  // Validate signature format
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    return { ok: false, error: 'invalid_signature', detail: 'Signature must be 65-byte hex' };
  }

  // Look up nonce
  const entry = nonceStore.get(nonce);
  if (!entry) {
    return { ok: false, error: 'nonce_not_found', detail: 'Nonce not found or already consumed' };
  }

  if (entry.used) {
    return { ok: false, error: 'nonce_used', detail: 'Nonce already consumed (replay protection)' };
  }

  if (entry.expiresAt < Date.now()) {
    nonceStore.delete(nonce);
    return { ok: false, error: 'nonce_expired', detail: 'Nonce expired (5min window)' };
  }

  // Build the canonical message
  const message = buildNonceSignMessage(normalizedWallet, nonce);

  // Verify signature
  let valid = false;
  try {
    valid = await verifyMessage({
      address: normalizedWallet,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return { ok: false, error: 'verify_failed', detail: 'Signature verification threw' };
  }

  if (!valid) {
    return { ok: false, error: 'signature_invalid', detail: 'Signature does not recover to wallet' };
  }

  // Mark nonce used
  entry.used = true;
  entry.wallet = normalizedWallet.toLowerCase();

  // Create session
  pruneSessions();
  const sessionId = randomBytes(32).toString('hex');
  const now = Date.now();
  const session: WalletSession = {
    sessionId,
    wallet: normalizedWallet.toLowerCase() as `0x${string}`,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };

  sessionStore.set(sessionId, session);

  const cookieToken = signSessionId(sessionId);

  return { ok: true, session, cookieToken };
}

/**
 * Resolve a session from a cookie token string.
 * Returns the session if valid and not expired, null otherwise.
 */
export function resolveSessionFromCookie(cookieValue: string): WalletSession | null {
  const sessionId = verifySessionToken(cookieValue);
  if (!sessionId) return null;

  const session = sessionStore.get(sessionId);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session;
}

/**
 * Destroy a session by cookie token.
 */
export function destroySession(cookieValue: string): boolean {
  const sessionId = verifySessionToken(cookieValue);
  if (!sessionId) return false;
  return sessionStore.delete(sessionId);
}

/**
 * Build Set-Cookie header value for the session cookie.
 */
export function buildSessionCookie(token: string, maxAgeSeconds = SESSION_TTL_MS / 1000): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];

  // Secure flag in production (HTTPS)
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Build Set-Cookie header to clear the session cookie.
 */
export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ── Test helpers ──────────────────────────────────────────────────────────

/** Reset stores — for tests only. */
export function __resetStoresForTests(): void {
  nonceStore.clear();
  sessionStore.clear();
}
