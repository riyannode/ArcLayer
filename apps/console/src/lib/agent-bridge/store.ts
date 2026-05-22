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
  job_id?: string | null;
  category?: string | null;
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
  totals: {
    events: number;
    receipts: number;
    roles: number;
  };
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
  jobId?: string | null;
  category?: string | null;
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
    job_id: input.jobId ?? null,
    category: input.category ?? null,
  };
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('agent_bridge_events')
    .insert(row)
.select('id, session_id, runtime_id, agent_id, role, type, event_type, payload, payload_hash, metadata, source, dry_run, job_id, category, created_at')
    .single();
  if (error) throw new Error(error.message);

  if (input.runtimeId) {
    const runtimeMetadata = {
      ...(input.metadata ?? {}),
      source: input.source || 'external-runtime',
    };
    const { error: runtimeError } = await supabase
      .from('external_agent_runtimes')
      .upsert({
        runtime_id: input.runtimeId,
        agent_id: input.agentId,
        role: input.role,
        category: input.category ?? null,
        endpoint: input.source || null,
        status: 'active',
        metadata: runtimeMetadata,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'runtime_id' });
    if (runtimeError) throw new Error(runtimeError.message);
  }

  return data;
}

export async function listBridgeEvents(filters: { sessionId?: string | null; role?: string | null; agentId?: string | null; runtimeId?: string | null; jobId?: string | null; category?: string | null; limit?: number }) {
  let q = getSupabaseAdmin()
    .from('agent_bridge_events')
.select('id, session_id, runtime_id, agent_id, role, type, event_type, payload, payload_hash, metadata, source, dry_run, job_id, category, created_at')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200));
  if (filters.sessionId) q = q.eq('session_id', filters.sessionId);
  if (filters.role) q = q.eq('role', filters.role);
  if (filters.agentId) q = q.eq('agent_id', filters.agentId);
  if (filters.runtimeId) q = q.eq('runtime_id', filters.runtimeId);
  if (filters.jobId) q = q.eq('job_id', filters.jobId);
  if (filters.category) q = q.eq('category', filters.category);
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

async function countBridgeEvents(sessionId: string) {
  const { count, error } = await getSupabaseAdmin()
    .from('agent_bridge_events')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countBridgeReceipts(sessionId: string) {
  const { count, error } = await getSupabaseAdmin()
    .from('agent_bridge_receipts')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countBridgeRoles(sessionId: string) {
  const events = await listBridgeEvents({ sessionId, limit: 200 });
  return new Set(events.map((event) => event.role).filter(Boolean)).size;
}

export async function latestBridgeSession(): Promise<BridgeSession | null> {
  const events = await listBridgeEvents({ limit: 100 });
  const latestSessionId = events[0]?.session_id;
  if (!latestSessionId) return null;

  const [sessionEvents, receipts, totalEvents, totalReceipts, totalRoles] = await Promise.all([
    listBridgeEvents({ sessionId: latestSessionId, limit: 100 }),
    listBridgeReceipts(latestSessionId),
    countBridgeEvents(latestSessionId),
    countBridgeReceipts(latestSessionId),
    countBridgeRoles(latestSessionId),
  ]);
  const orderedEvents = [...sessionEvents].reverse() as BridgeEventRow[];
  const roles: Record<string, BridgeEventRow | null> = {};

  for (const event of orderedEvents) {
    if (!event.role) continue;
    roles[event.role] = event;
  }

  return {
    sessionId: latestSessionId,
    roles,
    events: orderedEvents,
    receipts: receipts as BridgeReceiptRow[],
    totals: {
      events: totalEvents,
      receipts: totalReceipts,
      roles: totalRoles,
    },
  };
}
