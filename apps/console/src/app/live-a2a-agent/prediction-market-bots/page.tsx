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

const ROLE_FLOW = ['oracle', 'analyzer', 'evaluator', 'executor'] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function valueText(value: unknown, fallback = '—') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function shortValue(value: unknown, head = 10, tail = 6) {
  const raw = valueText(value, '');
  if (!raw) return '—';
  if (raw.length <= head + tail + 1) return raw;
  return `${raw.slice(0, head)}…${raw.slice(-tail)}`;
}

function eventType(event: RawEvent | null | undefined) {
  return valueText(event?.event_type ?? event?.type, 'waiting');
}

function roleTitle(role: string) {
  return role.toUpperCase();
}

function proofSummary(event: RawEvent | null | undefined) {
  const payload = asRecord(event?.payload);
  if (!payload) return 'No live event published for this role.';

  const raw = asRecord(payload.raw);
  const market = asRecord(raw?.market);
  const signalPreview = asRecord(payload.signalPreview);
  const signal = asRecord(payload.signal);
  const safety = asRecord(payload.safety);

  const marketSlug = market?.marketSlug;
  const question = market?.question;
  const direction = signalPreview?.suggestedDirection ?? signal?.suggestedDirection;
  const confidence = signalPreview?.confidence ?? signal?.confidence ?? payload.confidence;
  const approved = payload.approved;
  const riskLevel = payload.riskLevel;
  const action = payload.action;
  const mode = payload.mode;
  const reason = payload.reason ?? payload.noTradeReason;
  const summary = asRecord(payload.llmSummary)?.summary ?? payload.summary;

  if (marketSlug || question) {
    return `market ${valueText(marketSlug, valueText(question))}`;
  }
  if (direction || confidence) {
    return `signal ${valueText(direction, 'NEUTRAL')} · confidence ${valueText(confidence, '—')}`;
  }
  if (approved !== undefined || riskLevel) {
    return `evaluation ${valueText(approved, '—')} · risk ${valueText(riskLevel, '—')}`;
  }
  if (action || mode || safety) {
    return `execution ${valueText(action, '—')} · mode ${valueText(mode, '—')}`;
  }
  return valueText(summary ?? reason, 'Live payload recorded.');
}

function latestReceipts(session: SessionPayload) {
  const receipts = Array.isArray(session?.receipts) ? session.receipts : [];
  return receipts.slice(-3).reverse();
}

function LiveSessionProof({ session }: { session: SessionPayload }) {
  const receipts = latestReceipts(session);

  return (
    <section className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-[#C5A67C]">Live Session Proof</h2>
          <p className="mt-1 text-xs text-[#EAE4D8]/60">/api/agent-bridge/sessions/latest · role output and receipt mirror</p>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/45">
          read-only backend data
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ROLE_FLOW.map((role) => {
          const event = session?.roles?.[role] ?? null;
          const payloadHash = event?.payload_hash;
          const createdAt = event?.created_at;

          return (
            <article key={role} className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-orange-300">{roleTitle(role)}</div>
                  <div className="mt-1 truncate text-sm font-semibold text-zinc-100">{eventType(event)}</div>
                </div>
                <span className={[
                  'h-2.5 w-2.5 rounded-full',
                  event ? 'bg-orange-400 shadow-[0_0_14px_rgba(251,146,60,0.75)]' : 'bg-zinc-700',
                ].join(' ')} />
              </div>

              <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-zinc-500">{proofSummary(event)}</p>

              <div className="mt-4 space-y-2 font-mono text-[10px] text-zinc-500">
                <ProofRow label="agent" value={shortValue(event?.agent_id ?? event?.agentId, 14, 4)} />
                <ProofRow label="hash" value={shortValue(payloadHash)} />
                <ProofRow label="dry" value={valueText(event?.dry_run)} />
                <ProofRow label="seen" value={valueText(createdAt)} />
              </div>
            </article>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-[#0d0d0f] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-orange-300">Latest Receipts</div>
          <div className="font-mono text-[10px] text-zinc-600">{receipts.length} shown</div>
        </div>
        {receipts.length === 0 ? (
          <div className="text-xs text-zinc-500">No receipt published for the latest session.</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {receipts.map((receipt, index) => (
              <div key={`${valueText(receipt.id, 'receipt')}-${index}`} className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3 font-mono text-[10px] text-zinc-500">
                <ProofRow label="type" value={valueText(receipt.receipt_type)} />
                <ProofRow label="hash" value={shortValue(receipt.payload_hash)} />
                <ProofRow label="tx" value={shortValue(receipt.transaction ?? receipt.payment_id ?? receipt.payment_ref)} />
                <ProofRow label="time" value={valueText(receipt.created_at)} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ProofRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
      <span className="uppercase tracking-[0.16em] text-zinc-700">{label}</span>
      <span className="truncate text-zinc-400">{value || '—'}</span>
    </div>
  );
}

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
          <p className="mt-2 text-sm text-[#EAE4D8]/70 invisible">Live Polymarket BTC/ETH UpDown 15m monitor using /api/markets/crypto-updown/live?asset=BTC (no live execution).</p>
        </header>

        <section className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-4">
          <div className="font-mono text-xs text-[#F5F0E5]">
            Latest session: <span className="text-[#EAE4D8]/85">{shortSessionId}</span> · events {eventsCount} · receipts {receiptsCount}
          </div>
          {sessionError ? <div className="mt-3 rounded border border-red-400/25 bg-red-950/20 p-2 text-xs text-red-200">Session load failed: {sessionError}</div> : null}
        </section>

        <LiveSessionProof session={session} />

        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <PolymarketStyleBtcChart snapshot={data} loading={loading} error={error} onRefresh={refresh} />
          <PolymarketOrderbookPanel snapshot={data} loading={loading} />
        </section>

        <PredictionMarketAgentsStrip category="prediction-market-bots" />

      </div>
    </main>
  );
}
