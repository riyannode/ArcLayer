/**
 * Circle Gateway Payment Store — Supabase-backed (production-safe).
 *
 * Replaces the previous in-memory Map/Set implementation that did not survive
 * Vercel cold starts. All persistence operations are async and atomic via the
 * `x402_gateway_consume_payment` RPC.
 *
 * Migration: apps/console/supabase/migrations/002_x402_gateway_payments.sql
 *
 * Design:
 *  - `recordGatewayPayment` upserts with the `payment_id` PK so verify→settle
 *    transitions accumulate state (verified_at, settled_at, settle_payload).
 *  - `consumeGatewayPayment` calls a SECURITY DEFINER plpgsql function that
 *    SELECTs FOR UPDATE to lock the row, then atomically sets `consumed_at`.
 *    Replays return `{ ok: false, reason: 'replayed' }`.
 *
 * Backward compat: function names + result shapes match the prior in-memory
 * implementation. Callers in route.ts files must `await` the result; the old
 * sync API is gone.
 */

import { createHash } from 'crypto';
import { supabaseAdmin } from '../supabaseClient';

export type GatewayPaymentStatus =
  | 'verified'
  | 'accepted_pending_settlement'
  | 'settled'
  | 'consumed'
  | 'failed'
  // Aliases retained for backward compat with existing route.ts call sites:
  | 'accepted'
  | 'pending'
  | 'replayed';

export interface GatewayPaymentEvidence {
  paymentId: string;
  status: GatewayPaymentStatus;
  payer?: string;
  payTo?: string;
  amount?: string;
  asset?: string;
  network?: string;
  resource?: string;
  /**
   * Settlement reference. For Gateway this is Circle's internal UUID, NOT an EVM tx hash.
   * Kept named `transaction` for backward compat with existing call sites that pass through
   * Circle SDK's `SettleResponse.transaction` field unchanged.
   */
  transaction?: string;
  verifiedAt?: number;
  settledAt?: number;
  usedAt?: number;
  raw?: Record<string, unknown>;
}

interface GatewayPaymentRow {
  payment_id: string;
  status: string;
  payer: string | null;
  pay_to: string | null;
  amount: string | null;
  asset: string | null;
  network: string | null;
  resource: string | null;
  gateway_settlement_id: string | null;
  verify_payload: Record<string, unknown>;
  settle_payload: Record<string, unknown>;
  verified_at: string | null;
  settled_at: string | null;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ConsumeRpcRow {
  ok: boolean;
  reason: string | null;
  status: string | null;
  consumed_at: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function deriveGatewayPaymentId(
  paymentPayload: unknown,
  paymentRequirements: unknown,
): string {
  const encoded = stableStringify({ paymentPayload, paymentRequirements });
  return createHash('sha256').update(`gateway:x402:${encoded}`).digest('hex');
}

function rowToEvidence(row: GatewayPaymentRow): GatewayPaymentEvidence {
  return {
    paymentId: row.payment_id,
    status: row.status as GatewayPaymentStatus,
    payer: row.payer ?? undefined,
    payTo: row.pay_to ?? undefined,
    amount: row.amount ?? undefined,
    asset: row.asset ?? undefined,
    network: row.network ?? undefined,
    resource: row.resource ?? undefined,
    transaction: row.gateway_settlement_id ?? undefined,
    verifiedAt: row.verified_at ? Date.parse(row.verified_at) : undefined,
    settledAt: row.settled_at ? Date.parse(row.settled_at) : undefined,
    usedAt: row.consumed_at ? Date.parse(row.consumed_at) : undefined,
    raw: row.settle_payload && Object.keys(row.settle_payload).length > 0
      ? row.settle_payload
      : row.verify_payload,
  };
}

function normalizeStatusForDb(status: GatewayPaymentStatus): string {
  // Map legacy/alias statuses to canonical DB values.
  if (status === 'accepted' || status === 'pending') return 'accepted_pending_settlement';
  if (status === 'replayed') return 'consumed';
  return status;
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Upsert a payment row. Used by /api/x402/verify (status='verified') and
 * /api/x402/settle (status='settled' | 'accepted_pending_settlement').
 *
 * Merges with any existing row for the same paymentId so verify→settle
 * transitions accumulate state.
 */
export async function recordGatewayPayment(
  evidence: GatewayPaymentEvidence,
): Promise<GatewayPaymentEvidence> {
  const dbStatus = normalizeStatusForDb(evidence.status);

  const patch: Record<string, unknown> = {
    payment_id: evidence.paymentId,
    status: dbStatus,
  };

  if (evidence.payer !== undefined) patch.payer = evidence.payer;
  if (evidence.payTo !== undefined) patch.pay_to = evidence.payTo;
  if (evidence.amount !== undefined) patch.amount = evidence.amount;
  if (evidence.asset !== undefined) patch.asset = evidence.asset;
  if (evidence.network !== undefined) patch.network = evidence.network;
  if (evidence.resource !== undefined) patch.resource = evidence.resource;
  if (evidence.transaction !== undefined) patch.gateway_settlement_id = evidence.transaction;

  if (evidence.verifiedAt !== undefined) patch.verified_at = new Date(evidence.verifiedAt).toISOString();
  if (evidence.settledAt !== undefined) patch.settled_at = new Date(evidence.settledAt).toISOString();

  if (evidence.raw && Object.keys(evidence.raw).length > 0) {
    if (dbStatus === 'verified') {
      patch.verify_payload = evidence.raw;
    } else {
      patch.settle_payload = evidence.raw;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('x402_gateway_payments')
    .upsert(patch, { onConflict: 'payment_id' })
    .select()
    .single();

  if (error) {
    throw new Error(`[x402-gateway] recordGatewayPayment failed: ${error.message}`);
  }

  return rowToEvidence(data as GatewayPaymentRow);
}

/**
 * Read a payment row by paymentId. Returns undefined if not found.
 */
export async function getGatewayPayment(
  paymentId: string,
): Promise<GatewayPaymentEvidence | undefined> {
  const { data, error } = await supabaseAdmin
    .from('x402_gateway_payments')
    .select()
    .eq('payment_id', paymentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return undefined; // not found
    throw new Error(`[x402-gateway] getGatewayPayment failed: ${error.message}`);
  }

  return rowToEvidence(data as GatewayPaymentRow);
}

/**
 * Atomic consume — marks `consumed_at = now()` exactly once.
 *
 * Returns:
 *   { ok: true, evidence }                          → first consume succeeded
 *   { ok: false, reason: 'replayed', evidence? }   → consumed_at already set
 *   { ok: false, reason: 'missing' }                → paymentId not found
 */
export async function consumeGatewayPayment(
  paymentId: string,
): Promise<
  | { ok: true; evidence: GatewayPaymentEvidence }
  | { ok: false; reason: 'missing' | 'replayed'; evidence?: GatewayPaymentEvidence }
> {
  const { data, error } = await supabaseAdmin.rpc('x402_gateway_consume_payment', {
    p_payment_id: paymentId,
  });

  if (error) {
    throw new Error(`[x402-gateway] consumeGatewayPayment RPC failed: ${error.message}`);
  }

  const row = (data as unknown as ConsumeRpcRow[])[0];
  if (!row) {
    return { ok: false, reason: 'missing' };
  }

  if (row.ok) {
    const evidence = await getGatewayPayment(paymentId);
    if (!evidence) {
      // Race condition: row was deleted between RPC and SELECT. Treat as missing.
      return { ok: false, reason: 'missing' };
    }
    return { ok: true, evidence };
  }

  if (row.reason === 'missing') {
    return { ok: false, reason: 'missing' };
  }

  // replayed
  const evidence = await getGatewayPayment(paymentId);
  return { ok: false, reason: 'replayed', evidence };
}

/**
 * Summary for /api/x402/gateway-status diagnostic surface.
 * Returns latest 20 payments and counts.
 */
export async function gatewayEvidenceSummary(): Promise<{
  stored: number;
  used: number;
  payments: GatewayPaymentEvidence[];
}> {
  try {
    const { count: stored } = await supabaseAdmin
      .from('x402_gateway_payments')
      .select('*', { count: 'exact', head: true });

    const { count: used } = await supabaseAdmin
      .from('x402_gateway_payments')
      .select('*', { count: 'exact', head: true })
      .not('consumed_at', 'is', null);

    const { data: rows } = await supabaseAdmin
      .from('x402_gateway_payments')
      .select()
      .order('created_at', { ascending: false })
      .limit(20);

    return {
      stored: stored ?? 0,
      used: used ?? 0,
      payments: (rows ?? []).map((r) => rowToEvidence(r as GatewayPaymentRow)),
    };
  } catch {
    // Best-effort — diagnostic surface should never break the main flow.
    return { stored: 0, used: 0, payments: [] };
  }
}
