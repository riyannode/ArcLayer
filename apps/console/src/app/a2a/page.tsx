'use client';

import { useEffect, useState } from 'react';

type AgentStats = {
  callsServed: number;
  callsFailed: number;
  signalsCorrect: number;
  signalsWrong: number;
  cumulativePnlBps: number;
  calibrationScore: number;
  totalRevenue: string;
  reputationScore: number;
};

type A2AStatus = {
  chainId: number;
  contracts: Record<string, string>;
  agents: Record<string, { agentId: string; role: string; stats: AgentStats | null }>;
  markets: { totalIgnia: number | null; totalMirrors: number | null };
  timestamp: string;
};

function short(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function statTone(score?: number) {
  if (score == null) return 'text-[#7A7A7A]';
  if (score > 0) return 'text-emerald-300';
  if (score < 0) return 'text-red-300';
  return 'text-[#EAE4D8]';
}

export default function A2ADashboardPage() {
  const [data, setData] = useState<A2AStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/a2a/status', { cache: 'no-store' });
        if (!res.ok) throw new Error(`status_${res.status}`);
        const json = await res.json();
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (err: any) {
        if (alive) setError(err?.message || 'failed');
      }
    }
    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const agents = data ? Object.entries(data.agents) : [];

  return (
    <main className="min-h-screen bg-[#050505] px-5 py-24 text-[#EAE4D8]">
      <section className="mx-auto max-w-6xl">
        <div className="mb-10 border border-white/10 bg-black/30 p-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#C5A67C]">ArcLayer A2A Economy</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] md:text-5xl">Autonomous agents buying signals, trading markets, and earning reputation.</h1>
          <p className="mt-4 max-w-3xl font-mono text-sm leading-7 text-[#9A9A9A]">
            Live Arc Testnet dashboard for Pythia, Hermes, Ignia, receipt anchoring, market mirrors, and outcome-based reputation.
          </p>
        </div>

        {error && (
          <div className="mb-6 border border-red-400/30 bg-red-950/20 p-4 font-mono text-xs text-red-200">
            A2A status unavailable: {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="border border-white/10 bg-black/25 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#7A7A7A]">Ignia Markets</p>
            <p className="mt-3 font-mono text-3xl text-[#EAE4D8]">{data?.markets.totalIgnia ?? '—'}</p>
          </div>
          <div className="border border-white/10 bg-black/25 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#7A7A7A]">Polymarket Mirrors</p>
            <p className="mt-3 font-mono text-3xl text-[#EAE4D8]">{data?.markets.totalMirrors ?? '—'}</p>
          </div>
          <div className="border border-white/10 bg-black/25 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#7A7A7A]">Chain</p>
            <p className="mt-3 font-mono text-3xl text-[#EAE4D8]">{data?.chainId ?? 5042002}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {agents.map(([name, agent]) => (
            <div key={name} className="border border-white/10 bg-black/25 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">{name}</p>
                  <h2 className="mt-2 text-xl font-semibold capitalize">{agent.role.replaceAll('_', ' ')}</h2>
                </div>
                <span className="border border-white/10 px-2 py-1 font-mono text-[10px] text-[#9A9A9A]">{short(agent.agentId)}</span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 font-mono text-xs">
                <div className="border border-white/10 p-3">
                  <p className="text-[#7A7A7A]">Reputation</p>
                  <p className={`mt-2 text-2xl ${statTone(agent.stats?.reputationScore)}`}>{agent.stats?.reputationScore ?? '—'}</p>
                </div>
                <div className="border border-white/10 p-3">
                  <p className="text-[#7A7A7A]">PnL bps</p>
                  <p className={`mt-2 text-2xl ${statTone(agent.stats?.cumulativePnlBps)}`}>{agent.stats?.cumulativePnlBps ?? '—'}</p>
                </div>
                <div className="border border-white/10 p-3">
                  <p className="text-[#7A7A7A]">Correct</p>
                  <p className="mt-2 text-2xl text-emerald-300">{agent.stats?.signalsCorrect ?? '—'}</p>
                </div>
                <div className="border border-white/10 p-3">
                  <p className="text-[#7A7A7A]">Wrong</p>
                  <p className="mt-2 text-2xl text-red-300">{agent.stats?.signalsWrong ?? '—'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 border border-white/10 bg-black/25 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#7A7A7A]">Contracts</p>
          <div className="mt-4 grid gap-2 font-mono text-xs md:grid-cols-2">
            {data && Object.entries(data.contracts).map(([key, value]) => (
              <div key={key} className="flex min-w-0 items-center justify-between gap-3 border border-white/10 px-3 py-2">
                <span className="shrink-0 text-[#7A7A7A]">{key}</span>
                <span className="min-w-0 truncate text-[#EAE4D8]" title={value}>{short(value)}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 font-mono text-[11px] text-[#7A7A7A]">Last refresh: {data?.timestamp ?? 'loading…'}</p>
        </div>
      </section>
    </main>
  );
}
