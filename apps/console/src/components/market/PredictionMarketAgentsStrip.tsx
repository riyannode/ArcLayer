'use client';

import { useEffect, useMemo, useState } from 'react';
import AgentCards from './prediction-agents/AgentCards';
import NodeGraph from './prediction-agents/NodeGraph';
import type { PredictionAgentInput } from './prediction-agents/predictionAgentTypes';

type Agent = {
  agentId?: string | number | null;
  id?: string | number | null;
  name?: string | null;
  role?: string | null;
  endpoint?: string | null;
  categories?: string[];
  roles?: Array<{ id?: string; name?: string; category?: string; capabilities?: string[] }>;
  capabilities?: string[];
  x402?: { enabled?: boolean; price?: string } | null;
  updatedAt?: string;
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
  createdAt: string;
  paymentId?: string | null;
  paymentRef?: string | null;
  metadata?: Record<string, unknown> | null;
};

type BridgeEvent = Record<string, unknown>;
type BridgeSession = {
  roles?: Record<string, BridgeEvent | null>;
} | null;

const ACTIVITY_WINDOW_MS = 30_000;
const SCAN_BASE =
  process.env.NEXT_PUBLIC_ARC_SCAN_TX_BASE ||
  process.env.NEXT_PUBLIC_ARC_EXPLORER_TX_BASE ||
  process.env.NEXT_PUBLIC_TX_EXPLORER_BASE ||
  'https://testnet.arcscan.app/tx';
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

function agentKey(agent: Agent) {
  const value = agent.agentId ?? agent.id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function text(value: unknown, fallback = '—') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return fallback;
}

function shortText(value: unknown, head = 10, tail = 6) {
  const raw = text(value, '');
  if (!raw) return '—';
  if (raw.length <= head + tail + 1) return raw;
  return `${raw.slice(0, head)}…${raw.slice(-tail)}`;
}

function scanHref(value: unknown) {
  const raw = text(value, '');
  if (!SCAN_BASE || !/^0x[a-fA-F0-9]{64}$/.test(raw)) return '';
  return `${SCAN_BASE.replace(/\/$/, '')}/${raw}`;
}

function normalizeRole(value: unknown) {
  const raw = text(value, 'AGENT').toLowerCase();
  return ROLE_ALIASES[raw] ?? raw.toUpperCase();
}

function roleKey(value: unknown) {
  return normalizeRole(value).toLowerCase();
}

function isOnline(p?: AgentPresence) {
  if (!p?.lastHeartbeatAt || p.status !== 'online') return false;
  const t = new Date(p.lastHeartbeatAt).getTime();
  return Number.isFinite(t) && Date.now() - t < 30_000;
}

function isRecentEvent(event?: AgentLiveEvent, ms = ACTIVITY_WINDOW_MS) {
  if (!event?.createdAt) return false;
  const t = new Date(event.createdAt).getTime();
  return Number.isFinite(t) && Date.now() - t < ms;
}

function ageLabel(value?: string | null) {
  if (!value) return 'offline';
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return 'offline';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asTextArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => text(item, '')).filter(Boolean) : [];
}

function activityTx(event?: AgentLiveEvent) {
  const metadata = asRecord(event?.metadata);
  return event?.txHash ?? metadata?.txHash ?? metadata?.transaction ?? metadata?.transactionHash ?? null;
}

function activityPaymentRef(event?: AgentLiveEvent) {
  const metadata = asRecord(event?.metadata);
  return event?.paymentId ?? event?.paymentRef ?? metadata?.paymentId ?? metadata?.paymentRef ?? metadata?.payment_id ?? metadata?.payment_ref ?? null;
}

function latestActivityLabel(event?: AgentLiveEvent) {
  if (!event) return 'idle';
  const tx = activityTx(event);
  const paymentRef = activityPaymentRef(event);
  if (tx) return `${event.eventType} · tx ${shortText(tx)}`;
  if (paymentRef) return `${event.eventType} · payment ${shortText(paymentRef)}`;
  return event.summary || event.title || event.eventType || 'activity';
}

function bridgeProofLabel(event?: BridgeEvent | null) {
  if (!event) return 'no bridge proof';
  const eventType = text(event.event_type ?? event.type, 'bridge_event');
  const payload = asRecord(event.payload);
  const raw = asRecord(payload?.raw);
  const market = asRecord(raw?.market);
  const signalPreview = asRecord(payload?.signalPreview);
  const signal = asRecord(payload?.signal);
  const marketSlug = market?.marketSlug;
  const direction = signalPreview?.suggestedDirection ?? signal?.suggestedDirection;
  const confidence = signalPreview?.confidence ?? signal?.confidence ?? payload?.confidence;
  const approved = payload?.approved;
  const riskLevel = payload?.riskLevel;
  const action = payload?.action;
  const mode = payload?.mode;

  if (marketSlug) return `${eventType} · ${text(marketSlug)}`;
  if (direction || confidence) return `${eventType} · ${text(direction, 'NEUTRAL')} ${text(confidence, '')}`.trim();
  if (approved !== undefined || riskLevel) return `${eventType} · ${text(approved)} risk ${text(riskLevel)}`;
  if (action || mode) return `${eventType} · ${text(action)} ${text(mode, '')}`.trim();
  return eventType;
}

function compactReasoning(event?: BridgeEvent | null) {
  const payload = asRecord(event?.payload);
  if (!payload) {
    return { source: '—', summary: '—', why: '—', fallback: false };
  }

  const llmSummary = asRecord(payload.llmSummary);
  const source = text(payload.source ?? llmSummary?.source, '—');
  const summary = text(payload.summary ?? llmSummary?.summary ?? payload.reason ?? payload.noTradeReason, '—');
  const rationale = asTextArray(payload.rationale);
  const observations = asTextArray(llmSummary?.observations);
  const riskFlags = asTextArray(payload.riskFlags ?? payload.flags);
  const checks = asTextArray(payload.checks);
  const why = rationale[0] || observations[0] || riskFlags[0] || checks[0] || text(payload.reason ?? payload.noTradeReason, '—');
  const fallback = Boolean(payload.usedFallback ?? llmSummary?.usedFallback ?? source.includes('fallback'));

  return { source, summary, why, fallback };
}

function bridgeProofByRole(session?: BridgeSession) {
  const roles = session?.roles ?? {};
  const map = new Map<string, BridgeEvent>();
  for (const [role, event] of Object.entries(roles)) {
    if (event) map.set(roleKey(role), event);
  }
  return map;
}

function toPredictionAgentInputs(
  agents: Agent[],
  presenceByAgent: Map<string, AgentPresence>,
  latestEventByAgent: Map<string, AgentLiveEvent>,
  proofByRole: Map<string, BridgeEvent>,
): PredictionAgentInput[] {
  return agents.flatMap((agent) => {
    const id = agentKey(agent);
    if (!id) return [];

    const role = agent.role || agent.roles?.[0]?.name || agent.roles?.[0]?.id || 'agent';
    const normalizedRole = normalizeRole(role);
    const proof = proofByRole.get(normalizedRole.toLowerCase()) ?? null;
    const reasoning = compactReasoning(proof);
    const presence = presenceByAgent.get(id);
    const latest = latestEventByAgent.get(id);
    const online = isOnline(presence);
    const activityActive = isRecentEvent(latest);
    const recentX402 = latest?.eventType === 'x402_paid' && activityActive;
    const activityHash = activityTx(latest);

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
      status: online ? 'active' : 'unsynced',
      activity: latestActivityLabel(latest),
      activityHref: scanHref(activityHash),
      activitySeen: ageLabel(latest?.createdAt),
      activityActive,
      tx: shortText(activityHash),
      txHref: scanHref(activityHash),
      proof: bridgeProofLabel(proof),
      proofHash: '—',
      proofHashHref: '',
      proofSeen: text(proof?.created_at),
      proofActive: Boolean(proof),
      reasoningSource: reasoning.source,
      reasoningSummary: reasoning.summary,
      reasoningWhy: reasoning.why,
      reasoningFallback: reasoning.fallback,
    }];
  });
}

export function PredictionMarketAgentsStrip({ category = 'prediction-market-bots', bridgeSession = null }: { category?: string; bridgeSession?: BridgeSession }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [presence, setPresence] = useState<AgentPresence[]>([]);
  const [events, setEvents] = useState<AgentLiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadRoster() {
      try {
        const res = await fetch(`/api/a2a/agents/by-category?category=${encodeURIComponent(category)}`, { cache: 'no-store' });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || !json.ok) throw new Error(json.error || 'agents_fetch_failed');
        setAgents(Array.isArray(json.agents) ? json.agents : []);
        setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'agents_fetch_failed');
      }
    }

    void loadRoster();
    const id = setInterval(() => {
      if (!document.hidden) void loadRoster();
    }, 60_000);
    const onVisible = () => {
      if (!document.hidden) void loadRoster();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [category]);

  useEffect(() => {
    let alive = true;
    async function loadLive() {
      try {
        const [pRes, eRes] = await Promise.all([
          fetch(`/api/a2a/presence?category=${encodeURIComponent(category)}`, { cache: 'no-store' }),
          fetch(`/api/a2a/live-events?category=${encodeURIComponent(category)}&limit=50`, { cache: 'no-store' }),
        ]);
        const [pJson, eJson] = await Promise.all([pRes.json(), eRes.json()]);
        if (!alive) return;
        if (pRes.ok && pJson.ok) setPresence(Array.isArray(pJson.presence) ? pJson.presence : []);
        if (eRes.ok && eJson.ok) setEvents(Array.isArray(eJson.events) ? eJson.events : []);
      } catch {
        // no-op for live polling
      }
    }
    void loadLive();
    const id = setInterval(() => {
      if (!document.hidden) void loadLive();
    }, 5_000);
    const onVisible = () => {
      if (!document.hidden) void loadLive();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [category]);

  const presenceByAgent = useMemo(() => new Map(presence.map((p) => [p.agentId, p])), [presence]);
  const latestEventByAgent = useMemo(() => {
    const map = new Map<string, AgentLiveEvent>();
    for (const event of events) {
      if (!map.has(event.agentId)) map.set(event.agentId, event);
    }
    return map;
  }, [events]);
  const proofByRole = useMemo(() => bridgeProofByRole(bridgeSession), [bridgeSession]);
  const uiAgents = useMemo(
    () => toPredictionAgentInputs(agents, presenceByAgent, latestEventByAgent, proofByRole),
    [agents, presenceByAgent, latestEventByAgent, proofByRole],
  );

  return (
    <section className="space-y-4">
      <div className="flex justify-end">
        <a href="/register/autonomous?category=prediction-market-bots" className="rounded-sm border border-[#ff9100]/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#ff9100]">
          Register Bot →
        </a>
      </div>

      {error ? (
        <div className="rounded border border-red-400/20 bg-red-950/20 p-2 text-xs text-red-200">{error}</div>
      ) : null}

      <NodeGraph agents={uiAgents} />
      <AgentCards agents={uiAgents} />
    </section>
  );
}
