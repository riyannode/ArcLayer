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

/** Content event types that get a server-side dedupe key */
const CONTENT_EVENT_TYPES = new Set<BridgeEventType>(['market_snapshot', 'resolver_output', 'evaluation', 'execution_intent']);

/**
 * Build a deterministic dedupe key for content bridge events.
 *
 * v1 dedupes one content event per agent/role/session for PR204 demo validation.
 * Future resource marketplace flow should use v2 with upstreamPayloadHash/resourceId/jobId.
 *
 * event_dedupe_key = sha256("v1|" + sessionId + "|" + agentId + "|" + role + "|" + eventType)
 *
 * Only content events (market_snapshot, resolver_output, evaluation, execution_intent)
 * get a dedupe key. receipt_reference events return null — they are deduped via
 * the x402_resource_payments table instead.
 *
 * agentId is required in the key so external agents are not blocked
 * from publishing their own outputs.
 */
export function buildBridgeEventDedupeKey(input: { sessionId: string; agentId: string; role: string; type: BridgeEventType }): string | null {
  if (!CONTENT_EVENT_TYPES.has(input.type)) return null;
  const raw = `v1|${input.sessionId}|${input.agentId}|${input.role}|${input.type}`;
  return `0x${createHash('sha256').update(raw).digest('hex')}`;
}

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
  event_dedupe_key?: string | null;
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

/**
 * Recursive canonical stringify — produces deterministic output
 * regardless of object key insertion order.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Deterministic payload hash using canonical stable stringify.
 * { a:1, b:2 } and { b:2, a:1 } produce the same hash.
 */
export function stablePayloadHash(payload: unknown): string {
  return `0x${createHash('sha256').update(stableStringify(payload ?? {})).digest('hex')}`;
}

export function makeSessionId(prefix = 'bridge'): string {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export async function insertBridgeEvent(input: BridgeEventInput): Promise<BridgeEventRow & { deduped: boolean }> {
  // Compute dedupe key server-side from sessionId, agentId, role, type
  // Do NOT trust client-provided dedupe key
  const dedupeKey = buildBridgeEventDedupeKey({
    sessionId: input.sessionId,
    agentId: input.agentId,
    role: input.role,
    type: input.type,
  });

  const row: Record<string, unknown> = {
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
  // Only set event_dedupe_key for content events (receipt_reference stays null)
  if (dedupeKey) {
    row.event_dedupe_key = dedupeKey;
  }

  const supabase = getSupabaseAdmin();
  const selectFields = 'id, session_id, runtime_id, agent_id, role, type, event_type, payload, payload_hash, event_dedupe_key, metadata, source, dry_run, job_id, category, created_at';
  const { data, error } = await supabase
    .from('agent_bridge_events')
    .insert(row)
    .select(selectFields)
    .single();

  if (!error && data) {
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
    return { ...data, deduped: false };
  }

  // Handle duplicate key conflict on event_dedupe_key
  if (error && dedupeKey && error.message?.includes('duplicate key') || (error as any)?.code === '23505') {
    // Select existing row by dedupe key and return it as a deduped result
    const { data: existing } = await supabase
      .from('agent_bridge_events')
      .select(selectFields)
      .eq('event_dedupe_key', dedupeKey)
      .maybeSingle();
    if (existing) {
      return { ...existing, deduped: true };
    }
  }

  if (error) throw new Error(error.message);
  throw new Error('insert_failed_empty_response');
}

export async function listBridgeEvents(filters: { sessionId?: string | null; role?: string | null; agentId?: string | null; runtimeId?: string | null; jobId?: string | null; category?: string | null; limit?: number }) {
  let q = getSupabaseAdmin()
    .from('agent_bridge_events')
    .select('id, session_id, runtime_id, agent_id, role, type, event_type, payload, payload_hash, event_dedupe_key, metadata, source, dry_run, job_id, category, created_at')
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

/**
 * List distinct bridge session IDs with event counts, newest first.
 *
 * Uses bridge_session_summary view when available (efficient GROUP BY).
 * Falls back to scanning recent events if the view doesn't exist.
 */
export async function listBridgeSessions(limit = 20): Promise<{ sessionId: string; eventCount: number; firstEventAt?: string; lastEventAt?: string }[]> {
  const supabase = getSupabaseAdmin();

  // Try the view first — efficient GROUP BY
  const { data: viewData, error: viewError } = await supabase
    .from('bridge_session_summary')
    .select('session_id, event_count, first_event_at, last_event_at')
    .order('last_event_at', { ascending: false })
    .limit(limit);

  if (!viewError && viewData) {
    return viewData
      .filter((r) => r.session_id)
      .map((r) => ({
        sessionId: r.session_id,
        eventCount: r.event_count ?? 0,
        firstEventAt: r.first_event_at,
        lastEventAt: r.last_event_at,
      }));
  }

  // Fallback: scan recent events and dedupe client-side
  const { data, error } = await supabase
    .from('agent_bridge_events')
    .select('session_id')
    .order('created_at', { ascending: false })
    .limit(10000);

  if (error) throw new Error(error.message);

  const sessionMap = new Map<string, number>();
  for (const row of data ?? []) {
    if (!sessionMap.has(row.session_id)) {
      sessionMap.set(row.session_id, 0);
    }
    sessionMap.set(row.session_id, (sessionMap.get(row.session_id) ?? 0) + 1);
  }

  return Array.from(sessionMap.entries())
    .slice(0, limit)
    .map(([sessionId, eventCount]) => ({ sessionId, eventCount }));
}

/**
 * Count distinct bridge sessions.
 * Uses bridge_session_summary view when available.
 */
export async function countDistinctBridgeSessions(): Promise<number> {
  const supabase = getSupabaseAdmin();

  // Try the view first
  const { count: viewCount, error: viewError } = await supabase
    .from('bridge_session_summary')
    .select('*', { head: true, count: 'exact' });

  if (!viewError && viewCount !== null) {
    return viewCount;
  }

  // Fallback: scan recent events
  const { data, error } = await supabase
    .from('agent_bridge_events')
    .select('session_id')
    .order('created_at', { ascending: false })
    .limit(10000);

  if (error) throw new Error(error.message);
  return new Set(data?.map((r) => r.session_id) ?? []).size;
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

  function bridgeRoleEventPriority(event: BridgeEventRow) {
    const type = event.event_type || event.type;
    if (type === 'market_snapshot') return 100;
    if (type === 'resolver_output') return 100;
    if (type === 'evaluation') return 100;
    if (type === 'execution_intent') return 100;
    if (type === 'receipt_reference') return 10;
    return 50;
  }

  for (const event of orderedEvents) {
    if (!event.role) continue;

    const current = roles[event.role];
    if (!current) {
      roles[event.role] = event;
      continue;
    }

    if (bridgeRoleEventPriority(event) >= bridgeRoleEventPriority(current)) {
      roles[event.role] = event;
    }
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
