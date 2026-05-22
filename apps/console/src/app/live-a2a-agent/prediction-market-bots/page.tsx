'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PolymarketBtc15mPanel, PolymarketOrderbookPanel } from '@/components/market/PolymarketPanels';

type Session = { id: string; createdAt?: string; mode?: string };
type Event = { role?: string; type?: string; createdAt?: string; payloadHash?: string };
type Receipt = { id?: string; amount?: string; status?: string; createdAt?: string };

function useCryptoUpDownLive(_symbol: 'BTC') {
  return { up: null as number | null, down: null as number | null };
}

function PolymarketStyleBtcChart() {
  return (
    <section className="rounded-md border border-white/10 bg-[#0A0A0A]/90 p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">BTC Chart</div>
      <div className="mt-3 h-[220px] rounded-md border border-white/10 bg-black/30" />
    </section>
  );
}

function PredictionMarketAgentsStrip() {
  return (
    <section className="rounded-md border border-white/10 bg-[#0A0A0A]/90 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">Prediction Agents</div>
      <div className="mt-2 text-xs text-[#EAE4D8]/65">Oracle · Analyzer · Evaluator · Executor</div>
    </section>
  );
}

export default function PredictionMarketBotsPage() {
  useCryptoUpDownLive('BTC');
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [hasLiveData, setHasLiveData] = useState(false);

  function shortHash(value?: string) {
    if (!value) return '—';
    if (value.length <= 12) return value;
    return `${value.slice(0, 6)}…${value.slice(-4)}`;
  }

  useEffect(() => {
    (async () => {
      const latest = await fetch('/api/agent-bridge/sessions/latest').then((r) => r.json()).catch(() => null);
      if (!latest?.id) return;
      setSession(latest);
      const [ev, rc] = await Promise.all([
        fetch(`/api/agent-bridge/events?sessionId=${latest.id}`).then((r) => r.json()).catch(() => []),
        fetch(`/api/agent-bridge/receipts?sessionId=${latest.id}`).then((r) => r.json()).catch(() => []),
      ]);
      const nextEvents = Array.isArray(ev) ? ev.slice(0, 3) : [];
      const nextReceipts = Array.isArray(rc) ? rc.slice(0, 2) : [];
      setEvents(nextEvents);
      setReceipts(nextReceipts);
      setHasLiveData(Boolean(latest?.id) && (nextEvents.length > 0 || nextReceipts.length > 0));
    })();
  }, []);

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-6 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
        <header className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Agent Bridge</Link>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5]">Prediction Market Bots</h1>
        </header>
        <PolymarketStyleBtcChart />
        <PredictionMarketAgentsStrip />
        <section className="grid gap-3 lg:grid-cols-2">
          <PolymarketBtc15mPanel />
          <PolymarketOrderbookPanel />
        </section>
        <section className="rounded-md border border-white/10 bg-[#0A0A0A]/90 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C]">A2A Live Activity</div>
          {!hasLiveData ? (
            <div className="mt-2 text-xs text-[#EAE4D8]/60">No live A2A activity yet.</div>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs text-[#EAE4D8]/75">Events</div>
                {events.map((event, idx) => (
                  <div key={`${event.payloadHash ?? idx}`} className="border border-white/10 p-2 text-xs">
                    <div>{event.role ?? 'agent'} · {event.type ?? 'event'}</div>
                    <div className="text-[#EAE4D8]/55">{shortHash(event.payloadHash)}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="text-xs text-[#EAE4D8]/75">Receipts</div>
                {receipts.map((receipt, idx) => (
                  <div key={`${receipt.id ?? idx}`} className="border border-white/10 p-2 text-xs">
                    <div>{receipt.status ?? 'receipt'} · {shortHash(receipt.id)}</div>
                    <div className="text-[#EAE4D8]/55">{receipt.amount ?? '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {session?.id ? <div className="mt-2 text-xs text-[#EAE4D8]/50">session {shortHash(session.id)}</div> : null}
        </section>
      </div>
    </main>
  );
}
