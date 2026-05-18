/**
 * x402 Access Session Guard — server-side double-charge prevention.
 *
 * Flow:
 *   1. Before settlement, call `claimAccessSession(payer, resource, rail)`
 *   2. If active session exists → reject (409) BEFORE touching chain
 *   3. If no active session → claim slot → proceed to settle
 *   4. After successful settle → `completeAccessSession(...)` to record txHash
 *
 * Sessions auto-expire after TTL (default 1 hour).
 * Browser close + re-open after TTL → user can pay again.
 */

import { supabaseAdmin } from './supabaseClient';

export type Rail = 'arc-native' | 'circle-gateway';

export interface ClaimResult {
  ok: boolean;
  reason?: string;
  expiresAt?: string;
}

const DEFAULT_TTL_SECONDS = 3600; // 1 hour

/**
 * Attempt to claim an access session for (payer, resource, rail).
 * Returns { ok: true } if no active session exists (safe to settle).
 * Returns { ok: false, reason: 'active_session', expiresAt } if already paid.
 */
export async function claimAccessSession(
  payer: string,
  resource: string,
  rail: Rail,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<ClaimResult> {
  const { data, error } = await supabaseAdmin.rpc('x402_claim_access_session', {
    p_payer: payer,
    p_resource: resource,
    p_rail: rail,
    p_ttl_seconds: ttlSeconds,
  });

  if (error) {
    console.error('[x402-session] claimAccessSession RPC failed:', error.message);
    // Fail-closed: DB/session outage must not allow duplicate untracked settlement.
    return { ok: false, reason: 'session_store_unavailable' };
  }

  const row = (data as unknown as { ok: boolean; reason: string | null; expires_at: string | null }[])[0];
  if (!row) return { ok: true };

  if (row.ok) {
    return { ok: true, expiresAt: row.expires_at ?? undefined };
  }

  return {
    ok: false,
    reason: row.reason ?? 'active_session',
    expiresAt: row.expires_at ?? undefined,
  };
}

/**
 * Mark an active session as completed with payment details.
 */
export async function completeAccessSession(
  payer: string,
  resource: string,
  rail: Rail,
  paymentId: string,
  txHash?: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('x402_complete_access_session', {
    p_payer: payer,
    p_resource: resource,
    p_rail: rail,
    p_payment_id: paymentId,
    p_tx_hash: txHash ?? null,
  });

  if (error) {
    console.error('[x402-session] completeAccessSession failed:', error.message);
  }
}

/**
 * Force-expire an active session (e.g., on explicit user logout/reset).
 */
export async function releaseAccessSession(
  payer: string,
  resource: string,
  rail: Rail,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('x402_release_access_session', {
    p_payer: payer,
    p_resource: resource,
    p_rail: rail,
  });

  if (error) {
    console.error('[x402-session] releaseAccessSession failed:', error.message);
  }
}
