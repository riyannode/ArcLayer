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
};

function agentKey(agent: Agent) {
  const value = agent.agentId ?? agent.id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function isOnline(p?: AgentPresence) {
  if (!p?.lastHeartbeatAt || p.status !== 'online') return false;
  const t = new Date(p.lastHeartbeatAt).getTime();
  return Number.isFinite(t) && Date.now() - t < 30_000;
}

function isRecentEvent(event?: AgentLiveEvent, ms = 15_000) {
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

function toPredictionAgentInputs(
  agents: Agent[],
  presenceByAgent: Map<string, AgentPresence>,
  latestEventByAgent: Map<string, AgentLiveEvent>,
): PredictionAgentInput[] {
  return agents.flatMap((agent) => {
    const id = agentKey(agent);
    if (!id) return [];

    const presence = presenceByAgent.get(id);
    const latest = latestEventByAgent.get(id);
    const online = isOnline(presence);
    const recentX402 = latest?.eventType === 'x402_paid' && isRecentEvent(latest);

    return [{
      id,
      agentId: id,
      name: agent.name || id,
      role: agent.role || agent.roles?.[0]?.name || agent.roles?.[0]?.id || 'agent',
      category: recentX402 ? 'paid' : agent.x402?.enabled ? 'x402' : 'registered',
      endpoint: agent.endpoint ?? null,
      caps: agent.capabilities || agent.roles?.[0]?.capabilities || [],
      event: latest?.summary || latest?.title || presence?.lastEventSummary || presence?.lastEventType || 'waiting for heartbeat',
      seen: ageLabel(presence?.lastHeartbeatAt),
      status: online ? 'active' : 'unsynced',
    }];
  });
}

export function PredictionMarketAgentsStrip({ category = 'prediction-market-bots' }: { category?: string }) {
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
  const uiAgents = useMemo(
    () => toPredictionAgentInputs(agents, presenceByAgent, latestEventByAgent),
    [agents, presenceByAgent, latestEventByAgent],
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
