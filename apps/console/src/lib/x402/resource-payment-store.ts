import { createHash } from 'crypto';
import { supabaseAdmin, getSupabaseAdmin } from './supabaseClient';

export interface ResourcePaymentRecord {
  paymentKey: string;
  sessionId: string;
  scope: string;
  role: string;
  payer: string;
  resource: string;
  payTo: string;
  amount: string;
  mode: 'arc-native';
  status: 'pending' | 'settled' | 'failed';
  paymentId: string;
  transaction?: string | null;
}

export function buildResourcePaymentKey(input: { sessionId: string; scope: string; role: string; resource: string }): string {
  const normalized = `${input.resource.trim()}|${input.sessionId.trim()}|${input.scope.trim()}|${input.role.trim().toLowerCase()}`;
  return createHash('sha256').update(normalized).digest('hex');
}

function isProdArcTestnetMode(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.PROTOCOL_TX_MODE === 'ARC_TESTNET';
}

function ensureDbAvailable() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error(isProdArcTestnetMode() ? 'x402_resource_payments_unavailable' : 'supabase_unavailable');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(isProdArcTestnetMode() ? 'x402_resource_payments_unavailable' : 'supabase_unavailable');
  }
}

function mapRecord(data: Record<string, unknown>): ResourcePaymentRecord {
  return {
    paymentKey: String(data.payment_key),
    sessionId: String(data.session_id),
    scope: String(data.scope),
    role: String(data.role),
    payer: String(data.payer ?? ''),
    resource: String(data.resource),
    payTo: String(data.pay_to ?? ''),
    amount: String(data.amount ?? ''),
    mode: 'arc-native',
    status: data.status as ResourcePaymentRecord['status'],
    paymentId: String(data.payment_id ?? ''),
    transaction: (data.transaction as string | null | undefined) ?? null,
  };
}

export async function assertResourcePaymentStoreReady(): Promise<void> {
  // Verify env vars are set (supabaseAdmin Proxy would throw on access, but we
  // check explicitly to give a clear error message before any DB call)
  ensureDbAvailable();

  // Perform a cheap SELECT to prove the table is reachable in this deployment.
  // We catch Proxy-thrown errors from supabaseAdmin by calling getSupabaseAdmin()
  // explicitly before accessing the table — the Proxy wraps the same function.
  const client = getSupabaseAdmin();
  const { error } = await client.from('x402_resource_payments').select('payment_key', { count: 'exact', head: true }).limit(1);
  if (error) {
    throw new Error(`x402_resource_payments_unavailable: ${error.message}`);
  }
}

export async function getResourcePayment(key: string): Promise<ResourcePaymentRecord | null> {
  ensureDbAvailable();
  const { data, error } = await supabaseAdmin.from('x402_resource_payments').select('*').eq('payment_key', key).maybeSingle();
  if (error) throw error;
  return data ? mapRecord(data) : null;
}

export async function claimResourcePayment(record: ResourcePaymentRecord): Promise<{ kind: 'claimed' } | { kind: 'settled'; record: ResourcePaymentRecord } | { kind: 'pending'; record: ResourcePaymentRecord }> {
  ensureDbAvailable();
  const { error } = await supabaseAdmin.from('x402_resource_payments').insert({
    payment_key: record.paymentKey,
    session_id: record.sessionId,
    scope: record.scope,
    role: record.role,
    payer: record.payer.toLowerCase(),
    resource: record.resource,
    pay_to: record.payTo,
    amount: record.amount,
    mode: record.mode,
    status: 'pending',
    payment_id: record.paymentId,
    transaction: record.transaction ?? null,
  });

  if (!error) {
    console.log(
      `[x402][resource-payment] claimed sessionId=${record.sessionId} scope=${record.scope} role=${record.role} resource=${record.resource} paymentKey=${record.paymentKey.slice(0, 12)} kind=claimed`,
    );
    return { kind: 'claimed' };
  }

  const existing = await getResourcePayment(record.paymentKey);
  if (!existing) throw error;
  if (existing.status === 'settled') {
    console.log(
      `[x402][resource-payment] settled sessionId=${record.sessionId} scope=${record.scope} role=${record.role} resource=${record.resource} paymentKey=${record.paymentKey.slice(0, 12)} kind=settled`,
    );
    return { kind: 'settled', record: existing };
  }
  if (existing.status === 'failed') {
    const { error: retryError } = await supabaseAdmin
      .from('x402_resource_payments')
      .update({
        status: 'pending',
        payment_id: record.paymentId,
        transaction: null,
        payer: record.payer.toLowerCase(),
        pay_to: record.payTo,
        amount: record.amount,
        mode: record.mode,
      })
      .eq('payment_key', record.paymentKey)
      .eq('status', 'failed');
    if (!retryError) {
      console.log(
        `[x402][resource-payment] retry-from-failed sessionId=${record.sessionId} scope=${record.scope} role=${record.role} resource=${record.resource} paymentKey=${record.paymentKey.slice(0, 12)} kind=claimed`,
      );
      return { kind: 'claimed' };
    }
  }
  console.log(
    `[x402][resource-payment] pending sessionId=${record.sessionId} scope=${record.scope} role=${record.role} resource=${record.resource} paymentKey=${record.paymentKey.slice(0, 12)} kind=pending`,
  );
  return { kind: 'pending', record: existing };
}

export async function markResourcePaymentSettled(key: string, settlement: { transaction?: string | null; paymentId?: string }): Promise<void> {
  ensureDbAvailable();
  const update: Record<string, string | null> = { status: 'settled' };
  if (settlement.transaction !== undefined) update.transaction = settlement.transaction;
  if (settlement.paymentId !== undefined) update.payment_id = settlement.paymentId;
  const { error } = await supabaseAdmin.from('x402_resource_payments').update(update).eq('payment_key', key);
  if (error) throw error;
}

export async function markResourcePaymentFailed(key: string, reason?: string): Promise<void> {
  ensureDbAvailable();
  const { error } = await supabaseAdmin
    .from('x402_resource_payments')
    .update({
      status: 'failed',
      metadata: reason ? { reason } : {},
    })
    .eq('payment_key', key);
  if (error) throw error;
}
