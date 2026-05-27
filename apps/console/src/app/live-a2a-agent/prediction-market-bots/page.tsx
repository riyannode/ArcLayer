'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PredictionMarketAgentsStrip } from '@/components/market/PredictionMarketAgentsStrip';
import { PolymarketOrderbookPanel, PolymarketStyleBtcChart } from '@/components/market/PolymarketPanels';
import { useCryptoUpDownLive } from '@/hooks/useCryptoUpDownLive';

type RawEvent = Record<string, unknown>;
type RawReceipt = Record<string, unknown>;
type SessionPayload = {
  sessionId?: string;
  session_id?: string;
  roles?: Record<string, RawEvent | null>;
  events?: RawEvent[];
  receipts?: RawReceipt[];
} | null;
type LatestSessionResponse = { ok: boolean; session: SessionPayload; error?: string; message?: string };

export default function PredictionMarketBotsPage() {
  const { data, loading, error, refresh } = useCryptoUpDownLive('BTC');
  const [session, setSession] = useState<SessionPayload>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function loadSession() {
      try {
        const res = await fetch('/api/agent-bridge/sessions/latest', { cache: 'no-store' });
        const body = (await res.json()) as LatestSessionResponse;
        if (!active) return;
        if (!res.ok || !body.ok) {
          setSessionError(body.message || body.error || 'query_failed');
          return;
        }
        setSession(body.session ?? null);
        setSessionError(null);
      } catch (err) {
        if (!active) return;
        setSessionError(err instanceof Error ? err.message : 'network_error');
      }
    }

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const startPolling = () => {
      void loadSession();
      stopPolling();
      if (!document.hidden) {
        timer = setInterval(() => void loadSession(), 15_000);
      }
    };

    startPolling();
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
        return;
      }
      startPolling();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const sessionId = session?.sessionId || session?.session_id || '—';
  const shortSessionId = sessionId === '—' ? '—' : `${sessionId.slice(0, 10)}…`;
  const eventsCount = Array.isArray(session?.events) ? session.events.length : 0;
  const receiptsCount = Array.isArray(session?.receipts) ? session.receipts.length : 0;

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-6 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
        <header className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Agent Bridge</Link>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5]">Prediction Market Bots</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#EAE4D8]/70">
            ArcLayer is not a trading venue. It is the reputation layer for prediction-market agents.
            Bots read signals, execute through external or Arc-native venues, then submit receipts back to ArcLayer.
          </p>
        </header>

        <section className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-[#C5A67C]">
            Bots trade anywhere. ArcLayer records reputation.
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-mono text-[#EAE4D8]/70">
            <span>Market Feed</span>
            <span className="text-[#C5A67C]">→</span>
            <span>Bot Signal</span>
            <span className="text-[#C5A67C]">→</span>
            <span>Venue Adapter</span>
            <span className="text-[#C5A67C]">→</span>
            <span>Receipt</span>
            <span className="text-[#C5A67C]">→</span>
            <span>Reputation</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded border border-[#C5A67C]/10 bg-[#0D0D0D] p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-[#C5A67C]">Signal</div>
              <p className="mt-1 text-xs leading-5 text-[#EAE4D8]/70">Bots monitor market data, odds, orderbooks, and oracle events.</p>
            </div>
            <div className="rounded border border-[#C5A67C]/10 bg-[#0D0D0D] p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-[#C5A67C]">Execution</div>
              <p className="mt-1 text-xs leading-5 text-[#EAE4D8]/70">Orders are routed to external or Arc-native venues through adapters, not executed by ArcLayer.</p>
            </div>
            <div className="rounded border border-[#C5A67C]/10 bg-[#0D0D0D] p-3">
              <div className="text-xs font-bold uppercase tracking-wider text-[#C5A67C]">Reputation</div>
              <p className="mt-1 text-xs leading-5 text-[#EAE4D8]/70">Receipts, payload hashes, and job history build bot reputation.</p>
            </div>
          </div>
        </section>

        <section className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-4">
          <div className="font-mono text-xs text-[#F5F0E5]">
            Latest session: <span className="text-[#EAE4D8]/85">{shortSessionId}</span> · events {eventsCount} · receipts {receiptsCount}
          </div>
          {sessionError ? <div className="mt-3 rounded border border-red-400/25 bg-red-950/20 p-2 text-xs text-red-200">Session load failed: {sessionError}</div> : null}
        </section>

        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#C5A67C]/60">Reference Market Feed</span>
          <span className="h-px flex-1 bg-[#C5A67C]/10" />
          <span className="font-mono text-[10px] text-[#EAE4D8]/40">Signal context only. No trade execution happens here.</span>
        </div>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <PolymarketStyleBtcChart snapshot={data} loading={loading} error={error} onRefresh={refresh} />
          <PolymarketOrderbookPanel snapshot={data} loading={loading} />
        </section>

        <PredictionMarketAgentsStrip category="prediction-market-bots" bridgeSession={session} />

      </div>
    </main>
  );
}
