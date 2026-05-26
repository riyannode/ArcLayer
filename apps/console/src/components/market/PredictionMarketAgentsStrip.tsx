'use client';

import { useEffect, useMemo, useState } from 'react';
import { PredictionAgentLiveRail } from './PredictionAgentLiveRail';
import { ARC_SCAN_TX } from '@/components/agent-bridge/explorer';

type Agent = {
  agentId: string;
  name: string;
  role: string;
  endpoint?: string | null;
  categories: string[];
  roles?: Array<{ id: string; name: string; category: string; capabilities: string[] }>;
  capabilities: string[];
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

function short(v?: string | null) {
  if (!v) return '—';
  return v.length > 24 ? `${v.slice(0, 14)}…${v.slice(-6)}` : v;
}

function syncedLabel(updatedAt?: string) {
  if (!updatedAt) return 'unsynced';
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return 'unsynced';
  return `synced ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
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

  return (
    <section className="rounded-xl border border-white/10 bg-[#0A0A0A]/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Registered Prediction Agents</div>
          <div className="mt-1 text-xs text-[#EAE4D8]/55">{agents.length} registered for {category}</div>
        </div>

        <a href="/register/autonomous?category=prediction-market-bots" className="rounded-sm border border-[#C5A67C]/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#C5A67C]">
          Register Bot →
        </a>
      </div>

      <PredictionAgentLiveRail latestEvent={events[0] ?? null} />

      {error ? (
        <div className="rounded border border-red-400/20 bg-red-950/20 p-2 text-xs text-red-200">{error}</div>
      ) : agents.length === 0 ? (
        <div className="rounded border border-dashed border-white/10 bg-white/[0.02] p-3 text-center font-mono text-[11px] text-[#81796E]">No local registered agents found.</div>
      ) : (
        <div className="flex max-h-[210px] gap-2 overflow-x-auto pb-1">
          {agents.map((agent) => {
            const p = presenceByAgent.get(agent.agentId);
            const latest = latestEventByAgent.get(agent.agentId);
            const online = isOnline(p);
            const recentX402 = latest?.eventType === 'x402_paid' && isRecentEvent(latest);
            return (
              <article key={agent.agentId} className={[
                'min-w-[185px] max-w-[215px] rounded border bg-white/[0.03] p-3 transition',
                recentX402 ? 'border-emerald-300/60 shadow-[0_0_22px_rgba(52,211,153,0.25)] animate-pulse' : 'border-white/10',
              ].join(' ')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#F5F0E5]">{agent.name || short(agent.agentId)}</div>
                    <div className="mt-1 truncate font-mono text-[10px] uppercase text-[#81796E]">{agent.role || agent.roles?.[0]?.name || 'agent'}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={online ? 'h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.9)] animate-pulse' : 'h-2 w-2 rounded-full bg-white/20'} />
                    {latest?.eventType === 'x402_paid' ? <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 font-mono text-[9px] text-emerald-300">paid</span> : <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 font-mono text-[9px] text-emerald-300">{agent.x402?.enabled ? 'x402' : 'reg'}</span>}
                  </div>
                </div>

                <div className="mt-3 space-y-1 font-mono text-[10px] text-[#8A8378]">
                  <div className="truncate">id {short(agent.agentId)}</div>
                  <div className="truncate">endpoint {short(agent.endpoint)}</div>
                  <div className="truncate">caps {(agent.capabilities || []).slice(0, 2).join(', ') || '—'}</div>
                  <div className="truncate text-[#A69D90]">event {latest?.summary || latest?.title || p?.lastEventSummary || 'waiting'}</div>
                  {latest?.txHash && latest?.eventType === 'x402_paid' ? (
                    <a href={`${ARC_SCAN_TX}${latest.txHash}`} target="_blank" rel="noreferrer" className="truncate text-emerald-300 underline-offset-4 hover:underline">tx {short(latest.txHash)} ↗</a>
                  ) : null}
                  <div className="truncate text-[#81796E]">seen {ageLabel(p?.lastHeartbeatAt)}</div>
                  <div className="truncate text-[#A69D90]">{syncedLabel(agent.updatedAt)}</div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
