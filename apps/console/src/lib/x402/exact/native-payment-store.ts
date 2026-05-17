/**
 * Arc Native Payment Store — Supabase-backed idempotency ledger.
 *
 * Mirrors `gateway/payment-store.ts` but for the self-hosted EIP-3009 rail.
 *
 * Hard rule: this module MUST NEVER touch Circle Gateway state. It is the
 * authoritative idempotency record for `transferWithAuthorization` submissions
 * by the ArcLayer relayer, and nothing else.
 *
 * Key derivation:
 *   paymentId = sha256("native:x402:" || network || ":" || asset || ":" || from || ":" || nonce)
 *
 * Lifecycle:
 *   claim(...)  → INSERT pending (atomic). Returns existing row if conflict.
 *   markSettled / markFailed update the claimed row.
 *
 * Why we still need this when the chain enforces nonce uniqueness:
 *   On-chain `authorizationState(from, nonce)` only tells us "used / not used".
 *   It does NOT give us the previous tx hash, payer, or amount in O(1). Without
 *   a local ledger, the second click of "Settle" would re-submit
 *   transferWithAuthorization, get reverted with `authorization_used`, and
 *   surface to the UI as a payment failure even though the user already paid.
 */

import { createHash } from 'crypto';
import { supabaseAdmin } from '../supabaseClient';

export type NativePaymentStatus = 'pending' | 'settled' | 'failed';

export interface NativePaymentEvidence {
  paymentId: string;
  network: string;
  asset: string;
  payer: string;
  payTo?: string;
  amount?: string;
  nonce: string;
  txHash?: string;
  status: NativePaymentStatus;
  errorReason?: string;
  errorMessage?: string;
  settledAt?: number;
}

interface NativePaymentRow {
  payment_id: string;
  network: string;
  asset: string;
  payer: string;
  pay_to: string | null;
  amount: string | null;
  nonce: string;
  tx_hash: string | null;
  status: string;
  error_reason: string | null;
  error_message: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ClaimRpcRow {
  ok: boolean;
  status: string;
  tx_hash: string | null;
  payer: string | null;
  amount: string | null;
  settled_at: string | null;
}

// ─── derivation ───────────────────────────────────────────────────────────────

export interface NativePaymentIdentity {
  network: string;
  asset: string;
  from: string;
  nonce: string;
}

export function deriveNativePaymentId(identity: NativePaymentIdentity): string {
  const canonical = [
    identity.network.toLowerCase(),
    identity.asset.toLowerCase(),
    identity.from.toLowerCase(),
    identity.nonce.toLowerCase(),
  ].join(':');
  return createHash('sha256').update(`native:x402:${canonical}`).digest('hex');
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function rowToEvidence(row: NativePaymentRow): NativePaymentEvidence {
  return {
    paymentId: row.payment_id,
    network: row.network,
    asset: row.asset,
    payer: row.payer,
    payTo: row.pay_to ?? undefined,
    amount: row.amount ?? undefined,
    nonce: row.nonce,
    txHash: row.tx_hash ?? undefined,
    status: row.status as NativePaymentStatus,
    errorReason: row.error_reason ?? undefined,
    errorMessage: row.error_message ?? undefined,
    settledAt: row.settled_at ? Date.parse(row.settled_at) : undefined,
  };
}

// ─── public API ───────────────────────────────────────────────────────────────

export type ClaimNativePaymentResult =
  | {
      acquired: true;
      paymentId: string;
    }
  | {
      acquired: false;
      reason: 'already_settled' | 'in_flight' | 'previous_failed';
      existing: {
        paymentId: string;
        status: NativePaymentStatus;
        txHash?: string;
        payer?: string;
        amount?: string;
        settledAt?: number;
      };
    };

/**
 * Atomically claim ownership of a native payment slot.
 *
 * Returns `acquired: true` if the caller is the first to attempt this
 * (network, asset, payer, nonce) tuple. The caller owns the lock and MUST
 * follow up with `markNativeSettled` or `markNativeFailed`.
 *
 * Returns `acquired: false` with the reason and existing state otherwise.
 */
export async function claimNativePayment(
  identity: NativePaymentIdentity & {
    payTo?: string;
    amount?: string;
  },
): Promise<ClaimNativePaymentResult> {
  const paymentId = deriveNativePaymentId(identity);

  const { data, error } = await supabaseAdmin.rpc('x402_native_claim_payment', {
    p_payment_id: paymentId,
    p_network: identity.network,
    p_asset: identity.asset,
    p_payer: identity.from,
    p_pay_to: identity.payTo ?? null,
    p_amount: identity.amount ?? null,
    p_nonce: identity.nonce,
  });

  if (error) {
    throw new Error(`[x402-native] claimNativePayment RPC failed: ${error.message}`);
  }

  const row = (data as unknown as ClaimRpcRow[])[0];
  if (!row) {
    // RPC returned no row — should not happen, treat as fresh claim
    return { acquired: true, paymentId };
  }

  if (row.ok) {
    return { acquired: true, paymentId };
  }

  const reason: 'already_settled' | 'in_flight' | 'previous_failed' =
    row.status === 'settled'
      ? 'already_settled'
      : row.status === 'pending'
        ? 'in_flight'
        : 'previous_failed';

  return {
    acquired: false,
    reason,
    existing: {
      paymentId,
      status: row.status as NativePaymentStatus,
      txHash: row.tx_hash ?? undefined,
      payer: row.payer ?? undefined,
      amount: row.amount ?? undefined,
      settledAt: row.settled_at ? Date.parse(row.settled_at) : undefined,
    },
  };
}

/**
 * Mark a previously-claimed native payment as settled.
 * Idempotent — calling twice with the same paymentId/txHash is safe.
 */
export async function markNativeSettled(input: {
  paymentId: string;
  txHash: string;
  payTo?: string;
  amount?: string;
  raw?: Record<string, unknown>;
}): Promise<void> {
  const patch: Record<string, unknown> = {
    status: 'settled',
    tx_hash: input.txHash,
    settled_at: new Date().toISOString(),
    error_reason: null,
    error_message: null,
  };
  if (input.payTo !== undefined) patch.pay_to = input.payTo;
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.raw !== undefined) patch.raw = input.raw;

  const { error } = await supabaseAdmin
    .from('x402_native_payments')
    .update(patch)
    .eq('payment_id', input.paymentId);

  if (error) {
    throw new Error(`[x402-native] markNativeSettled failed: ${error.message}`);
  }
}

/**
 * Mark a previously-claimed native payment as failed.
 * Allows the same payer/nonce to be retried later (status -> 'failed' is
 * non-terminal for retries; the chain remains the source of truth).
 */
export async function markNativeFailed(input: {
  paymentId: string;
  errorReason: string;
  errorMessage: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('x402_native_payments')
    .update({
      status: 'failed',
      error_reason: input.errorReason,
      error_message: input.errorMessage,
    })
    .eq('payment_id', input.paymentId);

  if (error) {
    throw new Error(`[x402-native] markNativeFailed failed: ${error.message}`);
  }
}

/**
 * Read a native payment row by paymentId. Returns undefined if not found.
 */
export async function getNativePayment(
  paymentId: string,
): Promise<NativePaymentEvidence | undefined> {
  const { data, error } = await supabaseAdmin
    .from('x402_native_payments')
    .select()
    .eq('payment_id', paymentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return undefined; // not found
    throw new Error(`[x402-native] getNativePayment failed: ${error.message}`);
  }
  return rowToEvidence(data as NativePaymentRow);
}

/**
 * Backfill a settled record from on-chain evidence — used when the local
 * ledger is missing (Vercel cold start, fresh DB) but `authorizationState`
 * shows the nonce was used. Lets us return `alreadySettled: true` instead of
 * a confusing "authorization_used" error.
 */
export async function backfillNativeSettled(input: {
  identity: NativePaymentIdentity & {
    payTo?: string;
    amount?: string;
  };
  txHash?: string;
}): Promise<NativePaymentEvidence> {
  const paymentId = deriveNativePaymentId(input.identity);
  const patch = {
    payment_id: paymentId,
    network: input.identity.network,
    asset: input.identity.asset,
    payer: input.identity.from,
    pay_to: input.identity.payTo ?? null,
    amount: input.identity.amount ?? null,
    nonce: input.identity.nonce,
    tx_hash: input.txHash ?? null,
    status: 'settled' as const,
    settled_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('x402_native_payments')
    .upsert(patch, { onConflict: 'payment_id' })
    .select()
    .single();

  if (error) {
    throw new Error(`[x402-native] backfillNativeSettled failed: ${error.message}`);
  }
  return rowToEvidence(data as NativePaymentRow);
}
