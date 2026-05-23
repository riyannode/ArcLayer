'use client';

import { useEffect, useState } from 'react';
import {
  BotHealthPanel,
  LlmOutputPanel,
  ReceiptBreakdownPanel,
  SessionTimelinePanel,
  type BridgeSession,
} from '@/components/agent-bridge';

type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-black/25 px-4 py-3">
      <div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">{label}</div>
      <div className="font-mono text-lg text-[#C5A67C]">{value}</div>
    </div>
  );
}

export default function A2AProductionProofPage() {
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/agent-bridge/sessions/latest');
        const data = (await res.json()) as LatestResponse;
        if (!alive) return;
        if (!res.ok || !data.ok) {
          setError(data.message || data.error || 'query_failed');
          return;
        }
        setSession(data.session);
        setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'network_error');
      }
    }
    const loadVisible = () => {
      if (document.hidden) return;
      void load();
    };
    void load();
    const t = setInterval(loadVisible, 30_000);
    const onVisibility = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-5 pt-8 pb-12 sm:pt-12">
        <header className="overflow-hidden rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90">
          <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">ARCLAYER · PRODUCTION A2A PROOF</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5] sm:text-4xl">Live External PM2 Agent Proof</h1>
              <p className="mt-2 max-w-4xl text-sm text-[#EAE4D8]/70">Read-only evidence that external agents are alive, posting events, creating receipts, and settling through x402. No trading actions are executed here.</p>
            </div>
          </div>
          <div className="grid gap-px bg-white/10 md:grid-cols-4">
            <Stat label="Session" value={session?.sessionId ? `${session.sessionId.slice(0, 16)}…` : '—'} />
            <Stat label="Events" value={session?.events.length ?? 0} />
            <Stat label="Receipts" value={session?.receipts.length ?? 0} />
            <Stat label="Mode" value="read-only" />
          </div>
        </header>

        {error ? <div className="rounded-sm border border-red-400/25 bg-red-950/20 p-4 text-sm text-red-200">Bridge proof endpoint failed: {error}</div> : null}

        <BotHealthPanel session={session} />
        <ReceiptBreakdownPanel session={session} />
        <SessionTimelinePanel session={session} />
        <LlmOutputPanel session={session} />
      </div>
    </main>
  );
}
