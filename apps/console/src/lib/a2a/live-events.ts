import { listLocalIndexerAgentIdsByCategory } from '@/lib/a2a/local-indexer-roster';
import { listStoredManifests } from '@/lib/a2a/roster';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

const EVENTS_TABLE = 'agent_live_events';
const PRESENCE_TABLE = 'agent_presence';


function getVisibleAgentIdSet(): Set<string> | null {
  const raw =
    process.env.A2A_VISIBLE_AGENT_IDS ||
    process.env.NEXT_PUBLIC_A2A_VISIBLE_AGENT_IDS ||
    '';
  const ids = raw.split(',').map((v) => v.trim()).filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

function isVisibleAgentId(agentId: string): boolean {
  const visible = getVisibleAgentIdSet();
  if (!visible) return true;
  return visible.has(String(agentId));
}

export type AgentLiveEventType =
  | 'heartbeat'
  | 'x402_paid'
  | 'llm_reasoned'
  | 'job_claimed'
  | 'job_run'
  | 'proof_submitted'
  | 'error'
  // PR #2: ERC-8183 production lifecycle events
  | 'runtime_started'
  | 'runtime_completed'
  | 'job_discovered'
  | 'job_budget_set'
  | 'job_funded'
  | 'deliverable_published'
  | 'job_submitted'
  | 'evaluation_started'
  | 'evaluation_completed'
  | 'job_completed'
  | 'job_rejected'
  | 'reputation_queued'
  | 'reputation_published'
  | 'x402_payment_requested'
  | 'reconciliation_failed'
  | 'manual_review';

export type AgentPresenceStatus = 'online' | 'idle' | 'offline' | 'error';

export type AgentLiveEventInput = {
  agentId: string;
  agentName?: string | null;
  eventType: AgentLiveEventType;
  title?: string | null;
  summary?: string | null;
  txHash?: string | null;
  amountAtomic?: string | null;
  currency?: string | null;
  decision?: string | null;
  confidence?: number | null;
  trace?: string[];
  metadata?: Record<string, unknown>;
};

export type AgentPresenceInput = {
  agentId: string;
  agentName?: string | null;
  status?: AgentPresenceStatus;
  lastEventType?: string | null;
  lastEventSummary?: string | null;
  // Optional ERC-8183 bot metadata
  role?: string | null;
  runtimeType?: string | null;
  processName?: string | null;
  version?: string | null;
  chainId?: number | null;
  rpcOk?: boolean | null;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(value: unknown): AgentPresenceStatus {
  if (value === 'online' || value === 'idle' || value === 'offline' || value === 'error') return value;
  return 'online';
}

function normalizeTrace(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 24);
}

export async function recordAgentLiveEvent(input: AgentLiveEventInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const agentId = cleanString(input.agentId);
  if (!agentId) return { ok: false, error: 'missing_agent_id' };

  const eventType = cleanString(input.eventType);
  if (!eventType) return { ok: false, error: 'missing_event_type' };

  const supabase = getSupabaseAdmin();

  const row = {
    agent_id: agentId,
    agent_name: cleanString(input.agentName),
    event_type: eventType,
    title: cleanString(input.title),
    summary: cleanString(input.summary),
    tx_hash: cleanString(input.txHash),
    amount_atomic: cleanString(input.amountAtomic),
    currency: cleanString(input.currency),
    decision: cleanString(input.decision),
    confidence: typeof input.confidence === 'number' && Number.isFinite(input.confidence) ? input.confidence : null,
    trace: normalizeTrace(input.trace),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };

  const { error } = await supabase.from(EVENTS_TABLE).insert(row);
  if (error) {
    console.error('[a2a.live-events] insert error', error.message);
    return { ok: false, error: error.message };
  }

  await upsertAgentPresence({
    agentId,
    agentName: input.agentName ?? null,
    status: eventType === 'error' ? 'error' : 'online',
    lastEventType: eventType,
    lastEventSummary: input.summary ?? input.title ?? eventType,
  });

  return { ok: true };
}

export async function upsertAgentPresence(input: AgentPresenceInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const agentId = cleanString(input.agentId);
  if (!agentId) return { ok: false, error: 'missing_agent_id' };

  const now = new Date().toISOString();
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from(PRESENCE_TABLE).upsert(
    {
      agent_id: agentId,
      agent_name: cleanString(input.agentName),
      status: normalizeStatus(input.status),
      last_heartbeat_at: now,
      last_event_type: cleanString(input.lastEventType),
      last_event_summary: cleanString(input.lastEventSummary),
      updated_at: now,
      // Optional ERC-8183 bot metadata (only write if provided, keeps existing values otherwise)
      ...(input.role !== undefined && { role: cleanString(input.role) }),
      ...(input.runtimeType !== undefined && { runtime_type: cleanString(input.runtimeType) }),
      ...(input.processName !== undefined && { process_name: cleanString(input.processName) }),
      ...(input.version !== undefined && { version: cleanString(input.version) }),
      ...(input.chainId !== undefined && { chain_id: input.chainId }),
      ...(input.rpcOk !== undefined && { rpc_ok: input.rpcOk }),
    },
    { onConflict: 'agent_id' },
  );

  if (error) {
    console.error('[a2a.presence] upsert error', error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

async function listSupabaseManifestAgentIdsByCategory(category: string): Promise<string[]> {
  try {
    const manifests = await listStoredManifests();
    return manifests
      .filter((item) => {
        const manifest = item.manifest;
        return (
          manifest.categories?.includes(category) ||
          manifest.roles?.some((role) => role.category === category)
        );
      })
      .map((item) => item.agentId)
      .filter(Boolean);
  } catch (err) {
    console.error('[a2a.live-events] Supabase manifest lookup failed', err);
    return [];
  }
}

async function agentIdsForCategory(category: string): Promise<string[]> {
  const source = process.env.A2A_AGENT_ROSTER_SOURCE || 'local-indexer';

  if (source === 'global') {
    const ids = await listSupabaseManifestAgentIdsByCategory(category);
    return ids.filter((agentId) => isVisibleAgentId(agentId));
  }

  // Default local-indexer mode: merge local indexer IDs + Supabase manifest IDs
  let localIds: string[] = [];
  try {
    localIds = await listLocalIndexerAgentIdsByCategory(category);
  } catch (err) {
    console.error('[a2a.live-events] local indexer lookup failed, falling back to Supabase', err);
  }

  const supabaseIds = await listSupabaseManifestAgentIdsByCategory(category);

  // Merge + dedupe by agentId
  const merged = Array.from(new Set([...localIds, ...supabaseIds]));
  return merged.filter((agentId) => isVisibleAgentId(agentId));
}

export async function listAgentLiveEventsByCategory(category: string, limit = 50) {
  const agentIds = await agentIdsForCategory(category);
  if (agentIds.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(EVENTS_TABLE)
    .select('id, agent_id, agent_name, event_type, title, summary, tx_hash, amount_atomic, currency, decision, confidence, trace, metadata, created_at')
    .in('agent_id', agentIds)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)));

  if (error) {
    console.error('[a2a.live-events] list error', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    eventType: row.event_type,
    title: row.title,
    summary: row.summary,
    txHash: row.tx_hash,
    amountAtomic: row.amount_atomic,
    currency: row.currency,
    decision: row.decision,
    confidence: row.confidence,
    trace: Array.isArray(row.trace) ? row.trace : [],
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }));
}

export async function listAgentPresenceByCategory(category: string) {
  const ids = await agentIdsForCategory(category);
  if (ids.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(PRESENCE_TABLE)
    .select('agent_id, agent_name, status, last_heartbeat_at, last_event_type, last_event_summary, updated_at, role, runtime_type, process_name, version, chain_id, rpc_ok')
    .in('agent_id', ids);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map((data ?? []).map((row: any) => [row.agent_id, row]));

  if (error) {
    console.error('[a2a.presence] list error', error.message);
  }

  return ids.map((agentId) => {
    const row = byId.get(agentId) as Record<string, any> | undefined;
    return {
      agentId,
      agentName: row?.agent_name ?? null,
      status: row?.status ?? 'offline',
      lastHeartbeatAt: row?.last_heartbeat_at ?? null,
      lastEventType: row?.last_event_type ?? null,
      lastEventSummary: row?.last_event_summary ?? null,
      updatedAt: row?.updated_at ?? null,
      role: row?.role ?? null,
      runtimeType: row?.runtime_type ?? null,
      processName: row?.process_name ?? null,
      version: row?.version ?? null,
      chainId: row?.chain_id ?? null,
      rpcOk: row?.rpc_ok ?? null,
    };
  });
}

/** Read a single agent's presence by agent_id (for bot-health endpoint).
 *  Returns null if not found. Throws on DB errors so callers can distinguish. */
export async function getAgentPresenceById(agentId: string) {
  const id = cleanString(agentId);
  if (!id) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(PRESENCE_TABLE)
    .select('agent_id, agent_name, status, last_heartbeat_at, last_event_type, last_event_summary, updated_at, role, runtime_type, process_name, version, chain_id, rpc_ok')
    .eq('agent_id', id)
    .maybeSingle();

  if (error) {
    console.error('[a2a.presence] getAgentPresenceById error', error.message);
    throw new Error(`presence_read_failed: ${error.message}`);
  }

  if (!data) return null;

  return {
    agentId: data.agent_id,
    agentName: data.agent_name ?? null,
    status: data.status ?? 'offline',
    lastHeartbeatAt: data.last_heartbeat_at ?? null,
    lastEventType: data.last_event_type ?? null,
    lastEventSummary: data.last_event_summary ?? null,
    updatedAt: data.updated_at ?? null,
    role: data.role ?? null,
    runtimeType: data.runtime_type ?? null,
    processName: data.process_name ?? null,
    version: data.version ?? null,
    chainId: data.chain_id ?? null,
    rpcOk: data.rpc_ok ?? null,
  };
}
