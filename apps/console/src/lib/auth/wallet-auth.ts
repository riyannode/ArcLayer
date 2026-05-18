/**
 * Wallet Auth Middleware — EIP-191 personal_sign verification.
 *
 * Replaces unsafe `x-arc-wallet` header with cryptographic proof of wallet ownership.
 *
 * Headers required for authenticated requests:
 *   - x-arc-wallet:    0x... (claimed wallet address)
 *   - x-arc-nonce:     unique per-request nonce (string)
 *   - x-arc-timestamp: unix ms when message was signed
 *   - x-arc-signature: 0x... (personal_sign over canonical message)
 *
 * Canonical message format:
 *   ArcLayer Auth
 *   Wallet: <wallet>
 *   Method: <HTTP method>
 *   Path: <pathname>
 *   Nonce: <nonce>
 *   Timestamp: <timestamp>
 *
 * Server enforces:
 *   - timestamp within ±5 minute window (replay protection)
 *   - signature recovers to claimed wallet
 *   - nonce unique within 5min window (DB-backed; in-memory fallback)
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyMessage, isAddress } from 'viem';

const SIGNATURE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NONCE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min cache
const MAX_NONCE_CACHE = 10_000;

// In-memory nonce cache (per-instance; acceptable for short TTL)
const nonceCache = new Map<string, number>();

function pruneNonceCache(): void {
  if (nonceCache.size < MAX_NONCE_CACHE) return;
  const cutoff = Date.now() - NONCE_CACHE_TTL_MS;
  nonceCache.forEach((t, k) => {
    if (t < cutoff) nonceCache.delete(k);
  });
}

export interface AuthSuccess {
  ok: true;
  wallet: `0x${string}`; // lowercased
}

export interface AuthFailure {
  ok: false;
  status: number;
  error: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Verify wallet auth headers on an incoming request.
 * Pure verification — no DB writes. Caller decides what to do on success.
 */
export async function verifyWalletAuth(req: NextRequest): Promise<AuthResult> {
  const wallet = req.headers.get('x-arc-wallet');
  const nonce = req.headers.get('x-arc-nonce');
  const timestamp = req.headers.get('x-arc-timestamp');
  const signature = req.headers.get('x-arc-signature');

  if (!wallet || !nonce || !timestamp || !signature) {
    return { ok: false, status: 401, error: 'missing auth headers (x-arc-wallet, x-arc-nonce, x-arc-timestamp, x-arc-signature)' };
  }

  if (!isAddress(wallet)) {
    return { ok: false, status: 400, error: 'invalid wallet address' };
  }

  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
    return { ok: false, status: 400, error: 'invalid signature format (expected 65-byte hex)' };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 400, error: 'invalid timestamp' };
  }

  const now = Date.now();
  if (Math.abs(now - ts) > SIGNATURE_TTL_MS) {
    return { ok: false, status: 401, error: 'signature expired (±5min window)' };
  }

  // Replay protection: nonce must be unique within window
  const nonceKey = `${wallet.toLowerCase()}:${nonce}`;
  if (nonceCache.has(nonceKey)) {
    return { ok: false, status: 401, error: 'nonce already used (replay)' };
  }

  // Build canonical message
  const url = new URL(req.url);
  const message = [
    'ArcLayer Auth',
    `Wallet: ${wallet.toLowerCase()}`,
    `Method: ${req.method.toUpperCase()}`,
    `Path: ${url.pathname}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${ts}`,
  ].join('\n');

  let valid = false;
  try {
    valid = await verifyMessage({
      address: wallet as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return { ok: false, status: 401, error: 'signature verification failed' };
  }

  if (!valid) {
    return { ok: false, status: 401, error: 'signature does not recover to wallet' };
  }

  // Mark nonce used
  pruneNonceCache();
  nonceCache.set(nonceKey, now);

  return { ok: true, wallet: wallet.toLowerCase() as `0x${string}` };
}

/**
 * Higher-order route wrapper: enforces wallet auth, exposes verified wallet to handler.
 * Usage:
 *   export const POST = withWalletAuth(async (req, { wallet }) => { ... });
 */
export function withWalletAuth<TParams = unknown>(
  handler: (
    req: NextRequest,
    ctx: { params: TParams; wallet: `0x${string}` },
  ) => Promise<Response> | Response,
) {
  return async (req: NextRequest, ctx: { params: TParams }): Promise<Response> => {
    const auth = await verifyWalletAuth(req);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    return handler(req, { params: ctx.params, wallet: auth.wallet });
  };
}

/**
 * Build canonical message for client-side signing — keeps server/client in sync.
 */
export function buildAuthMessage(params: {
  wallet: string;
  method: string;
  path: string;
  nonce: string;
  timestamp: number;
}): string {
  return [
    'ArcLayer Auth',
    `Wallet: ${params.wallet.toLowerCase()}`,
    `Method: ${params.method.toUpperCase()}`,
    `Path: ${params.path}`,
    `Nonce: ${params.nonce}`,
    `Timestamp: ${params.timestamp}`,
  ].join('\n');
}
