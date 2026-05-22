'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BridgeSession } from '@/components/agent-bridge';
import { BtcCandlestickPanel, PolymarketBtc15mPanel, PolymarketOrderbookPanel } from '@/components/market/PolymarketPanels';
import { PredictionMarketDecisionBoardV2 } from '@/components/agent-bridge/PredictionMarketDecisionBoardV2';

type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };

export default function PredictionMarketBotsPage() {
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/agent-bridge/sessions/latest', { cache: 'no-store' });
        const data = (await res.json()) as LatestResponse;
        if (!alive) return;
        if (!res.ok || !data.ok) { setError(data.message || data.error || 'query_failed'); return; }
        setSession(data.session); setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'network_error');
      }
    }
    load();
    const id = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-6 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
        <header className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Agent Bridge</Link>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5]">Prediction Market Bots</h1>
          <p className="mt-2 text-sm text-[#EAE4D8]/70">Market Data Panel + Decision Board flow untuk ORACLE sampai EXECUTOR dengan receipt chain dan status x402.</p>
          {error ? <div className="mt-3 rounded border border-red-400/30 bg-red-950/20 p-2 text-sm text-red-200">{error}</div> : null}
        </header>

        <section className="grid gap-3 lg:grid-cols-3">
          <PolymarketBtc15mPanel />
          <PolymarketOrderbookPanel />
          <BtcCandlestickPanel />
        </section>

        <PredictionMarketDecisionBoardV2 session={session} />
      </div>
    </main>
  );
}
