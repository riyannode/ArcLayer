import { createHash } from 'crypto';
import { supabaseAdmin } from './supabaseClient';

export interface ResourcePaymentRecord {
  paymentKey: string;
  sessionId: string;
  scope: string;
  payer: string;
  resource: string;
  payTo: string;
  amount: string;
  mode: 'arc-native';
  status: 'pending' | 'settled';
  paymentId: string;
  transaction?: string | null;
}

const memoryFallback = new Map<string, ResourcePaymentRecord>();

export function buildResourcePaymentKey(input: { sessionId: string; scope: string; payer: string; resource: string }): string {
  const normalized = `${input.sessionId.trim()}|${input.scope.trim()}|${input.payer.toLowerCase()}|${input.resource.trim()}`;
  return createHash('sha256').update(normalized).digest('hex');
}

export async function getResourcePayment(key: string): Promise<ResourcePaymentRecord | null> {
  try {
    const { data, error } = await supabaseAdmin.from('x402_resource_payments').select('*').eq('payment_key', key).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      paymentKey: data.payment_key,
      sessionId: data.session_id,
      scope: data.scope,
      payer: data.payer,
      resource: data.resource,
      payTo: data.pay_to,
      amount: data.amount,
      mode: 'arc-native',
      status: data.status,
      paymentId: data.payment_id,
      transaction: data.transaction ?? null,
    };
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

export async function putResourcePayment(record: ResourcePaymentRecord): Promise<void> {
  memoryFallback.set(record.paymentKey, record);
  try {
    const { error } = await supabaseAdmin.from('x402_resource_payments').upsert({
      payment_key: record.paymentKey,
      session_id: record.sessionId,
      scope: record.scope,
      payer: record.payer.toLowerCase(),
      resource: record.resource,
      pay_to: record.payTo,
      amount: record.amount,
      mode: record.mode,
      status: record.status,
      payment_id: record.paymentId,
      transaction: record.transaction ?? null,
    }, { onConflict: 'payment_key' });
    if (error) throw error;
  } catch {
    // In-memory fallback is intentionally retained for local/dev when DB is unavailable.
  }
}

export async function markResourcePaymentSettled(key: string, settlement: { transaction?: string | null; paymentId?: string }): Promise<void> {
  const existing = memoryFallback.get(key);
  if (existing) {
    memoryFallback.set(key, { ...existing, status: 'settled', transaction: settlement.transaction ?? existing.transaction ?? null, paymentId: settlement.paymentId ?? existing.paymentId });
  }
  try {
    const update: Record<string, string | null> = { status: 'settled' };
    if (settlement.transaction !== undefined) update.transaction = settlement.transaction;
    if (settlement.paymentId !== undefined) update.payment_id = settlement.paymentId;
    const { error } = await supabaseAdmin.from('x402_resource_payments').update(update).eq('payment_key', key);
    if (error) throw error;
  } catch {
    // Best effort; caller still has in-memory fallback.
  }
}
