'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PredictionMarketAgentsStrip } from '@/components/market/PredictionMarketAgentsStrip';
import { PolymarketOrderbookPanel, PolymarketStyleBtcChart } from '@/components/market/PolymarketPanels';
import { useCryptoUpDownLive } from '@/hooks/useCryptoUpDownLive';

type RawEvent = Record<string, unknown>;
type RawReceipt = Record<string, unknown>;
type SessionPayload = { sessionId?: string; session_id?: string; events?: RawEvent[]; receipts?: RawReceipt[] } | null;
type LatestSessionResponse = { ok: boolean; session: SessionPayload; error?: string; message?: string };
type ApiEnvelope<T> = {
  ok: boolean;
  source?: string;
  timestamp?: string;
  total?: number;
  capturedAt?: string;
  data?: T;
  agents?: T;
  presence?: T;
  events?: T;
  error?: string;
  message?: string;
};

type AgentListItem = Record<string, unknown>;
type PresenceItem = Record<string, unknown>;
type LiveEventItem = Record<string, unknown>;

function provenanceValue(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return '—';
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value);
}

export default function PredictionMarketBotsPage() {
  const { data, loading, error, refresh } = useCryptoUpDownLive('BTC');
  const [session, setSession] = useState<SessionPayload>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [presence, setPresence] = useState<PresenceItem[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEventItem[]>([]);
  const [liveApiError, setLiveApiError] = useState<string | null>(null);
  const [liveSource, setLiveSource] = useState<string>('—');
  const [liveCapturedAt, setLiveCapturedAt] = useState<string>('—');

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

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function loadA2AReadOnlyData() {
      try {
        const [aRes, pRes, eRes] = await Promise.all([
          fetch('/api/a2a/agents/by-category?category=prediction-market-bots', { cache: 'no-store' }),
          fetch('/api/a2a/presence?category=prediction-market-bots', { cache: 'no-store' }),
          fetch('/api/a2a/live-events?category=prediction-market-bots&limit=50', { cache: 'no-store' }),
        ]);
        const [aBody, pBody, eBody] = (await Promise.all([aRes.json(), pRes.json(), eRes.json()])) as [
          ApiEnvelope<AgentListItem[]>,
          ApiEnvelope<PresenceItem[]>,
          ApiEnvelope<LiveEventItem[]>,
        ];
        if (!active) return;

        if (!aRes.ok || !aBody.ok || !pRes.ok || !pBody.ok || !eRes.ok || !eBody.ok) {
          const msg = aBody.message || pBody.message || eBody.message || aBody.error || pBody.error || eBody.error || 'query_failed';
          setLiveApiError(msg);
          return;
        }

        setAgents(Array.isArray(aBody.agents) ? aBody.agents : []);
        setPresence(Array.isArray(pBody.presence) ? pBody.presence : []);
        setLiveEvents(Array.isArray(eBody.events) ? eBody.events : []);
        setLiveSource(aBody.source || pBody.source || eBody.source || '—');
        setLiveCapturedAt(aBody.timestamp || pBody.timestamp || eBody.timestamp || '—');
        setLiveApiError(null);
      } catch (err) {
        if (!active) return;
        setLiveApiError(err instanceof Error ? err.message : 'network_error');
      }
    }

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const startPolling = () => {
      void loadA2AReadOnlyData();
      stopPolling();
      if (!document.hidden) {
        timer = setInterval(() => void loadA2AReadOnlyData(), 15_000);
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
          <p className="mt-2 text-sm text-[#EAE4D8]/70 invisible">Live Polymarket BTC/ETH UpDown 15m monitor using /api/markets/crypto-updown/live?asset=BTC (no live execution).</p>
        </header>

        <section className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-4">
          <div className="font-mono text-xs text-[#F5F0E5]">
            Latest session: <span className="text-[#EAE4D8]/85">{shortSessionId}</span> · events {eventsCount} · receipts {receiptsCount}
          </div>
          {sessionError ? <div className="mt-3 rounded border border-red-400/25 bg-red-950/20 p-2 text-xs text-red-200">Session load failed: {sessionError}</div> : null}
        </section>

        <section className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-4">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-[#C5A67C]">Live A2A Read-Only Feed</h2>
          {liveApiError ? (
            <div className="mt-3 rounded border border-red-400/25 bg-red-950/20 p-2 text-xs text-red-200">live source unavailable — no mock data rendered ({liveApiError})</div>
          ) : (
            <>
              <div className="mt-3 text-xs text-[#EAE4D8]/75">source: {liveSource} · capturedAt: {liveCapturedAt}</div>
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <div className="rounded border border-[#C5A67C]/15 p-3">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#C5A67C]">/api/a2a/agents/by-category</div>
                  <div className="mt-2 text-xs text-[#EAE4D8]/80">rows: {agents.length}</div>
                </div>
                <div className="rounded border border-[#C5A67C]/15 p-3">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#C5A67C]">/api/a2a/presence</div>
                  <div className="mt-2 text-xs text-[#EAE4D8]/80">rows: {presence.length}</div>
                </div>
                <div className="rounded border border-[#C5A67C]/15 p-3">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#C5A67C]">/api/a2a/live-events</div>
                  <div className="mt-2 text-xs text-[#EAE4D8]/80">rows: {liveEvents.length}</div>
                  {liveEvents.length === 0 ? <div className="mt-2 text-xs text-[#EAE4D8]/65">no live event published</div> : null}
                </div>
              </div>
              <div className="mt-4 overflow-auto rounded border border-[#C5A67C]/15">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-[#101010] text-[#C5A67C]">
                    <tr>
                      <th className="px-2 py-2">agentId</th>
                      <th className="px-2 py-2">source</th>
                      <th className="px-2 py-2">created_at</th>
                      <th className="px-2 py-2">payload_hash</th>
                      <th className="px-2 py-2">rawEvidenceHash</th>
                      <th className="px-2 py-2">dry_run</th>
                      <th className="px-2 py-2">receipt_type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(liveEvents.length ? liveEvents : [{ agentId: '—' }]).map((item, i) => {
                      const row = item as Record<string, unknown>;
                      return (
                        <tr key={`${provenanceValue(row, 'agentId')}-${i}`} className="border-t border-[#C5A67C]/10">
                          <td className="px-2 py-2">{provenanceValue(row, 'agentId')}</td>
                          <td className="px-2 py-2">{liveSource}</td>
                          <td className="px-2 py-2">{provenanceValue(row, 'created_at') === '—' ? provenanceValue(row, 'createdAt') : provenanceValue(row, 'created_at')}</td>
                          <td className="px-2 py-2">{provenanceValue(row, 'payload_hash')}</td>
                          <td className="px-2 py-2">{provenanceValue(row, 'rawEvidenceHash')}</td>
                          <td className="px-2 py-2">{provenanceValue(row, 'dry_run')}</td>
                          <td className="px-2 py-2">{provenanceValue(row, 'receipt_type')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <PolymarketStyleBtcChart snapshot={data} loading={loading} error={error} onRefresh={refresh} />
          <PolymarketOrderbookPanel snapshot={data} loading={loading} />
        </section>

        <PredictionMarketAgentsStrip category="prediction-market-bots" />

      </div>
    </main>
  );
}
