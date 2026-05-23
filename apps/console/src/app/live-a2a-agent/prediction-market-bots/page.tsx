'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PredictionMarketAgentsStrip } from '@/components/market/PredictionMarketAgentsStrip';
import { PolymarketBtc15mPanel, PolymarketOrderbookPanel, PolymarketStyleBtcChart } from '@/components/market/PolymarketPanels';
import { useCryptoUpDownLive } from '@/hooks/useCryptoUpDownLive';

type RawEvent = Record<string, unknown>;
type RawReceipt = Record<string, unknown>;
type SessionPayload = { sessionId?: string; session_id?: string; events?: RawEvent[]; receipts?: RawReceipt[] } | null;
type LatestSessionResponse = { ok: boolean; session: SessionPayload; error?: string; message?: string };

type DisplayEvent = { payloadHash: string; type: string; createdAt: string; role: string; agentId: string };
type DisplayReceipt = { status: string; id: string; hash: string; createdAt: string };

const asText = (value: unknown) => (typeof value === 'string' ? value : '');

function normalizeEvent(event: RawEvent): DisplayEvent {
  return {
    payloadHash: asText(event.payload_hash) || asText(event.payloadHash) || '—',
    type: asText(event.event_type) || asText(event.type) || 'unknown',
    createdAt: asText(event.created_at) || asText(event.createdAt) || '—',
    role: asText(event.role) || '—',
    agentId: asText(event.agent_id) || asText(event.agentId) || '—',
  };
}

function normalizeReceipt(receipt: RawReceipt): DisplayReceipt {
  return {
    status: asText(receipt.receipt_type) || asText(receipt.status) || asText(receipt.type) || 'unknown',
    id: asText(receipt.payment_id) || asText(receipt.transaction) || asText(receipt.id) || '—',
    hash: asText(receipt.payload_hash) || asText(receipt.hash) || '—',
    createdAt: asText(receipt.created_at) || asText(receipt.createdAt) || '—',
  };
}

export default function PredictionMarketBotsPage() {
  const { data, loading, error, refresh } = useCryptoUpDownLive('BTC');
  const [session, setSession] = useState<SessionPayload>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

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

    loadSession();
    const timer = setInterval(loadSession, 15_000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const sessionId = session?.sessionId || session?.session_id || '—';
  const events = useMemo(() => (Array.isArray(session?.events) ? session.events.map(normalizeEvent) : []), [session?.events]);
  const receipts = useMemo(() => (Array.isArray(session?.receipts) ? session.receipts.map(normalizeReceipt) : []), [session?.receipts]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-6 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
        <header className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Agent Bridge</Link>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5]">Prediction Market Bots</h1>
          <p className="mt-2 text-sm text-[#EAE4D8]/70">Live Polymarket BTC/ETH UpDown 15m monitor using /api/markets/crypto-updown/live?asset=BTC (no live execution).</p>
        </header>

        <section className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">Latest Session</div><div className="mt-1 font-mono text-sm text-[#F5F0E5] break-all">{sessionId}</div></div>
            <div><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">Events</div><div className="mt-1 font-mono text-xl text-[#F5F0E5]">{events.length}</div></div>
            <div><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">Receipts</div><div className="mt-1 font-mono text-xl text-[#F5F0E5]">{receipts.length}</div></div>
          </div>
          {sessionError ? <div className="mt-3 rounded border border-red-400/25 bg-red-950/20 p-2 text-xs text-red-200">Session load failed: {sessionError}</div> : null}
        </section>

        <PolymarketStyleBtcChart snapshot={data} loading={loading} error={error} onRefresh={refresh} />
        <PredictionMarketAgentsStrip category="prediction-market-bots" />
        <section className="grid gap-3 lg:grid-cols-2"><PolymarketBtc15mPanel snapshot={data} loading={loading} error={error} /><PolymarketOrderbookPanel snapshot={data} loading={loading} /></section>

        <section className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">Session Events</div>
            {events.length === 0 ? <div className="mt-2 text-sm text-[#EAE4D8]/70">No events found in latest session.</div> : (
              <div className="mt-2 space-y-2">{events.slice(0, 8).map((event, i) => <div key={`${event.payloadHash}-${i}`} className="rounded border border-white/10 p-2 text-xs"><div>type: <span className="font-mono">{event.type}</span></div><div>payloadHash: <span className="font-mono">{event.payloadHash}</span></div><div>createdAt: <span className="font-mono">{event.createdAt}</span></div></div>)}</div>
            )}
          </div>
          <div className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">Session Receipts</div>
            {receipts.length === 0 ? <div className="mt-2 text-sm text-[#EAE4D8]/70">No receipts found in latest session.</div> : (
              <div className="mt-2 space-y-2">{receipts.slice(0, 8).map((receipt, i) => <div key={`${receipt.id}-${i}`} className="rounded border border-white/10 p-2 text-xs"><div>status/type: <span className="font-mono">{receipt.status}</span></div><div>id: <span className="font-mono">{receipt.id}</span></div><div>hash: <span className="font-mono">{receipt.hash}</span></div><div>createdAt: <span className="font-mono">{receipt.createdAt}</span></div></div>)}</div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
