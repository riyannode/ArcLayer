import { createHash, randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export type BridgeRole =
  | 'external_runtime'
  | 'registered_agent'
  | 'verification'
  | 'executor'
  | 'oracle'
  | 'momentum_resolver'
  | 'scalping_resolver'
  | 'evaluator'
  | 'spot_trader'
  | 'prediction_market_trader'
  | 'arbitrage_bot'
  | 'research_agent'
  | 'analyzer'
  | 'data_provider'
  | 'risk_manager'
  | 'rwa_evaluator'
  | 'custom_worker'
  | (string & {});
export type BridgeEventType = 'session_started' | 'bridge_event' | 'work_proof' | 'receipt_reference' | 'market_snapshot' | 'resolver_output' | 'evaluation' | 'execution_intent';

export type BridgeEventRow = {
  id: string;
  session_id: string;
  runtime_id?: string | null;
  agent_id?: string | null;
  role: string;
  type?: string | null;
  event_type?: string | null;
  payload: Record<string, unknown>;
  payload_hash: string;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  dry_run?: boolean | null;
  created_at: string;
};

export type BridgeReceiptRow = {
  id: string;
  session_id: string;
  receipt_type: string;
  payment_id?: string | null;
  payment_ref?: string | null;
  transaction?: string | null;
  payload_hash: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type BridgeSession = {
  sessionId: string;
  roles: Record<string, BridgeEventRow | null>;
  events: BridgeEventRow[];
  receipts: BridgeReceiptRow[];
};
export type BridgeReceiptType = 'x402_arc_native' | 'x402_circle_gateway' | 'dry_run';

export interface BridgeEventInput {
  sessionId: string;
  runtimeId?: string | null;
  agentId: string;
  role: BridgeRole;
  type: BridgeEventType;
  payload: Record<string, unknown>;
  payloadHash?: string;
  metadata?: Record<string, unknown> | null;
  source?: string;
  dryRun?: boolean;
}

export interface BridgeReceiptInput {
  sessionId: string;
  receiptType: BridgeReceiptType;
  paymentId?: string | null;
  transaction?: string | null;
  payloadHash?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function stablePayloadHash(payload: unknown): string {
  return `0x${createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex')}`;
}

export function makeSessionId(prefix = 'bridge'): string {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export async function insertBridgeEvent(input: BridgeEventInput) {
  const row = {
    session_id: input.sessionId,
    runtime_id: input.runtimeId ?? null,
    agent_id: input.agentId,
    role: input.role,
    event_type: input.type,
    payload: input.payload ?? {},
    payload_hash: input.payloadHash || stablePayloadHash(input.payload ?? {}),
    metadata: input.metadata ?? {},
    source: input.source || 'external-runtime',
    dry_run: input.dryRun !== false,
  };
  const { data, error } = await getSupabaseAdmin()
    .from('agent_bridge_events')
    .insert(row)
    .select('id, session_id, runtime_id, agent_id, role, type, event_type, payload, payload_hash, metadata, source, dry_run, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listBridgeEvents(filters: { sessionId?: string | null; role?: string | null; limit?: number }) {
  let q = getSupabaseAdmin()
    .from('agent_bridge_events')
    .select('id, session_id, runtime_id, agent_id, role, type, event_type, payload, payload_hash, metadata, source, dry_run, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200));
  if (filters.sessionId) q = q.eq('session_id', filters.sessionId);
  if (filters.role) q = q.eq('role', filters.role);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function insertBridgeReceipt(input: BridgeReceiptInput) {
  const row = {
    session_id: input.sessionId,
    receipt_type: input.receiptType,
    payment_id: input.paymentId ?? null,
    transaction: input.transaction ?? null,
    payload_hash: input.payloadHash ?? stablePayloadHash(input),
    metadata: input.metadata ?? {},
  };
  const { data, error } = await getSupabaseAdmin()
    .from('agent_bridge_receipts')
    .insert(row)
    .select('id, session_id, receipt_type, payment_id, transaction, payload_hash, metadata, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function listBridgeReceipts(sessionId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from('agent_bridge_receipts')
    .select('id, session_id, receipt_type, payment_id, transaction, payload_hash, metadata, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function latestBridgeSession(): Promise<BridgeSession | null> {
  const events = await listBridgeEvents({ limit: 100 });
  const latestSessionId = events[0]?.session_id;
  if (!latestSessionId) return null;

  const sessionEvents = (await listBridgeEvents({ sessionId: latestSessionId, limit: 100 })).reverse() as BridgeEventRow[];
  const receipts = (await listBridgeReceipts(latestSessionId)) as BridgeReceiptRow[];
  const roles: Record<string, BridgeEventRow | null> = {};

  for (const event of sessionEvents) {
    if (!event.role) continue;
    roles[event.role] = event;
  }

  return {
    sessionId: latestSessionId,
    roles,
    events: sessionEvents,
    receipts,
  };
}
