'use client';

/**
 * useA2AAgents — Reusable hook for A2A agent data.
 * Extracted from PredictionMarketAgentsStrip.
 *
 * Fetches roster, presence, and live-events from existing APIs.
 * Normalizes into PredictionAgentInput[] with status/reasoning.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  normalizePredictionAgents,
  type PredictionAgentInput,
} from '@/components/market/prediction-agents/predictionAgentTypes';
import { safeJson } from '@/lib/safeFetch';

// ─── Raw API types ───────────────────────────────────────────────────────────

type RawAgent = {
  agentId?: string | number | null;
  id?: string | number | null;
  name?: string | null;
  role?: string | null;
  endpoint?: string | null;
  categories?: string[];
  roles?: Array<{ id?: string; name?: string; category?: string; capabilities?: string[] }>;
  capabilities?: string[];
  x402?: { enabled?: boolean; price?: string } | null;
  controller?: string | null;
  updatedAt?: string | null;
};

type AgentPresence = {
  agentId: string;
  agentName?: string | null;
  status: 'online' | 'idle' | 'offline' | 'error';
  lastHeartbeatAt?: string | null;
  lastEventType?: string | null;
  lastEventSummary?: string | null;
  updatedAt?: string | null;
};

type AgentLiveEvent = {
  id?: number;
  agentId: string;
  agentName?: string | null;
  eventType: string;
  title?: string | null;
  summary?: string | null;
  txHash?: string | null;
  amountAtomic?: string | null;
  currency?: string | null;
  decision?: string | null;
  confidence?: number | null;
  trace?: string[];
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  paymentId?: string | null;
  paymentRef?: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACTIVITY_WINDOW_MS = 30_000;
const HEARTBEAT_FRESH_MS = 30_000;

const ROLE_ALIASES: Record<string, string> = {
  analyst: 'ANALYZER',
  analysis: 'ANALYZER',
  analyzer: 'ANALYZER',
  evaluator: 'EVALUATOR',
  evaluation: 'EVALUATOR',
  executor: 'EXECUTOR',
  execute: 'EXECUTOR',
  oracle: 'ORACLE',
  market: 'MARKET-AGENT',
  'market-agent': 'MARKET-AGENT',
  market_agent: 'MARKET-AGENT',
  agent: 'AGENT',
};

function text(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function shortText(value: unknown, head = 10, tail = 6): string {
  const raw = text(value, '');
  if (!raw) return '—';
  if (raw.length <= head + tail + 1) return raw;
  return `${raw.slice(0, head)}…${raw.slice(-tail)}`;
}

function agentKey(agent: RawAgent): string {
  const value = agent.agentId ?? agent.id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function normalizeRole(value: unknown): string {
  const raw = text(value, 'AGENT').toLowerCase();
  return ROLE_ALIASES[raw] ?? raw.toUpperCase();
}

function roleKey(value: unknown): string {
  return normalizeRole(value).toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item, '')).filter(Boolean)
    : [];
}

function ageLabel(value?: string | null): string {
  if (!value) return 'offline';
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return 'offline';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

const EXPLORER_BASE = 'https://testnet.arcscan.app';

function explorerTxUrl(hash: string | null): string {
  if (!hash) return '';
  // If it's already 0x-prefixed hex, use directly
  if (hash.startsWith('0x') && hash.length >= 10) return `${EXPLORER_BASE}/tx/${hash}`;
  // If it's a hex string without 0x prefix (like paymentId), add prefix
  if (/^[a-fA-F0-9]{64}$/.test(hash)) return `${EXPLORER_BASE}/tx/0x${hash}`;
  // UUID or other format — not on-chain, return empty
  return '';
}

function isOnline(p?: AgentPresence): boolean {
  if (!p?.lastHeartbeatAt || p.status !== 'online') return false;
  const t = new Date(p.lastHeartbeatAt).getTime();
  return Number.isFinite(t) && Date.now() - t < HEARTBEAT_FRESH_MS;
}

function isRecentEvent(event?: AgentLiveEvent, ms = ACTIVITY_WINDOW_MS): boolean {
  if (!event?.createdAt) return false;
  const t = new Date(event.createdAt).getTime();
  return Number.isFinite(t) && Date.now() - t < ms;
}

// ─── Reasoning extraction (from live events) ────────────────────────────────

function extractReasoningFromEvent(event: AgentLiveEvent): string | null {
  const metadata = asRecord(event.metadata);
  if (!metadata) return null;

  const llmSummary = asRecord(metadata.llmSummary);
  const signal = asRecord(metadata.signal);
  const signalPreview = asRecord(metadata.signalPreview);

  return (
    text(event.summary, '') ||
    text(event.title, '') ||
    text(llmSummary?.summary, '') ||
    text(signal?.suggestedDirection, '') ||
    text(signalPreview?.suggestedDirection, '') ||
    text(event.trace?.[0], '') ||
    null
  );
}

// ─── Bridge proof helpers ────────────────────────────────────────────────────

function activityTx(event?: AgentLiveEvent): string | null {
  const metadata = asRecord(event?.metadata);
  return (event?.txHash ?? metadata?.txHash ?? metadata?.transaction ?? metadata?.transactionHash) as string | null;
}

function activityPaymentRef(event?: AgentLiveEvent): string | null {
  const metadata = asRecord(event?.metadata);
  return (event?.paymentId ?? event?.paymentRef ?? metadata?.paymentId ?? metadata?.paymentRef ?? metadata?.payment_id ?? metadata?.payment_ref) as string | null;
}

function latestActivityLabel(event?: AgentLiveEvent): string {
  if (!event) return 'idle';
  const tx = activityTx(event);
  const paymentRef = activityPaymentRef(event);
  if (tx) return `${event.eventType} · tx ${shortText(tx)}`;
  if (paymentRef) return `${event.eventType} · payment ${shortText(paymentRef)}`;
  return event.summary || event.title || event.eventType || 'activity';
}

// ─── Exported types ──────────────────────────────────────────────────────────

export type A2AAgentStats = {
  roster: number;
  agents: number;
  presence: number;
  events: number;
  online: number;
};

export type A2AReturn = {
  agents: PredictionAgentInput[];
  onlineAgents: PredictionAgentInput[];
  reasoning: Map<string, string>;
  stats: A2AAgentStats;
  loading: boolean;
  error: string | null;
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useA2AAgents(category: string): A2AReturn {
  const [rawAgents, setRawAgents] = useState<RawAgent[]>([]);
  const [rosterTotal, setRosterTotal] = useState(0);
  const [presence, setPresence] = useState<AgentPresence[]>([]);
  const [events, setEvents] = useState<AgentLiveEvent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  // ── Fetch roster (60s) ──
  const fetchRoster = useCallback(async () => {
    setRosterLoading(true);
    try {
      const res = await fetch(`/api/a2a/agents/by-category?category=${encodeURIComponent(category)}`, { cache: 'no-store' });
      const json = await safeJson<{ ok: boolean; agents?: RawAgent[]; total?: number; error?: string }>(res);
      if (!res.ok || !json.ok) throw new Error(json.error || 'agents_fetch_failed');
      const list = Array.isArray(json.agents) ? json.agents : [];
      setRawAgents(list);
      setRosterTotal(json.total ?? list.length);
      setRosterError(null);
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : 'agents_fetch_failed');
    } finally {
      setRosterLoading(false);
    }
  }, [category]);

  // ── Fetch presence + events (5s) ──
  const fetchLive = useCallback(async () => {
    try {
      const [pRes, eRes] = await Promise.all([
        fetch(`/api/a2a/presence?category=${encodeURIComponent(category)}`, { cache: 'no-store' }),
        fetch(`/api/a2a/live-events?category=${encodeURIComponent(category)}&limit=50`, { cache: 'no-store' }),
      ]);
      const [pJson, eJson] = await Promise.all([
        safeJson<{ ok: boolean; presence?: AgentPresence[] }>(pRes),
        safeJson<{ ok: boolean; events?: AgentLiveEvent[] }>(eRes),
      ]);
      if (pRes.ok && pJson.ok) setPresence(Array.isArray(pJson.presence) ? pJson.presence : []);
      if (eRes.ok && eJson.ok) setEvents(Array.isArray(eJson.events) ? eJson.events : []);
    } catch {
      // Keep stale live state visible if polling fails
    }
  }, [category]);

  // ── Polling with visibility awareness ──
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = () => {
      if (!alive || document.hidden) return;
      void fetchRoster();
    };

    run();
    timer = setInterval(run, 60_000);

    const onVisible = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchRoster]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const run = () => {
      if (!alive || document.hidden) return;
      void fetchLive();
    };

    run();
    timer = setInterval(run, 5_000);

    const onVisible = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchLive]);

  // ── Derived data ──
  const presenceByAgent = useMemo(() => new Map(presence.map((p) => [p.agentId, p])), [presence]);

  const latestEventByAgent = useMemo(() => {
    const map = new Map<string, AgentLiveEvent>();
    for (const event of events) {
      if (!map.has(event.agentId)) map.set(event.agentId, event);
    }
    return map;
  }, [events]);

  // Reasoning text per agent (from latest event metadata)
  const reasoning = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of events) {
      if (map.has(event.agentId)) continue; // keep first (latest) only
      const text = extractReasoningFromEvent(event);
      if (text) map.set(event.agentId, text);
    }
    return map;
  }, [events]);

  // Normalize agents into PredictionAgentInput[]
  const agents = useMemo(() => {
    return rawAgents.flatMap((agent) => {
      const id = agentKey(agent);
      if (!id) return [];

      const role = agent.role || agent.roles?.[0]?.name || agent.roles?.[0]?.id || 'agent';
      const presence = presenceByAgent.get(id);
      const latest = latestEventByAgent.get(id);
      const online = isOnline(presence);
      const activityActive = isRecentEvent(latest);
      const recentX402 = latest?.eventType === 'x402_paid' && activityActive;
      const activityHash = activityTx(latest);
      const payRef = activityPaymentRef(latest);
      const txDisplayHash = activityHash || payRef;
      const txExplorerUrl = explorerTxUrl(payRef) || explorerTxUrl(activityHash);

      return [{
        id,
        agentId: id,
        name: agent.name || id,
        role,
        category: recentX402 ? 'paid' : agent.x402?.enabled ? 'x402' : 'registered',
        endpoint: agent.endpoint ?? null,
        caps: agent.capabilities || agent.roles?.[0]?.capabilities || [],
        event: latest?.summary || latest?.title || presence?.lastEventSummary || presence?.lastEventType || 'waiting for live event',
        seen: ageLabel(presence?.lastHeartbeatAt),
        status: (online ? 'active' : 'unsynced') as 'active' | 'unsynced',
        activity: latestActivityLabel(latest),
        activityHref: '',
        activitySeen: ageLabel(latest?.createdAt),
        activityActive,
        tx: shortText(txDisplayHash),
        txHref: txExplorerUrl,
        proof: payRef ? 'gateway payment' : 'no proof',
        proofHash: shortText(payRef),
        proofHashHref: explorerTxUrl(payRef),
        proofSeen: '—',
        proofActive: false,
        reasoningSource: '—',
        reasoningSummary: reasoning.get(id) || '—',
        reasoningWhy: '—',
        reasoningFallback: false,
      }];
    });
  }, [rawAgents, presenceByAgent, latestEventByAgent, reasoning]);

  const onlineAgents = useMemo(
    () => agents.filter((a) => a.status === 'active'),
    [agents],
  );

  const onlineCount = useMemo(
    () => [...presenceByAgent.values()].filter(isOnline).length,
    [presenceByAgent],
  );

  const stats: A2AAgentStats = {
    roster: rosterTotal,
    agents: agents.length,
    presence: presence.length,
    events: events.length,
    online: onlineCount,
  };

  return {
    agents,
    onlineAgents,
    reasoning,
    stats,
    loading: rosterLoading,
    error: rosterError,
  };
}
