'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BridgeSession } from '@/components/agent-bridge';
import { shortHash } from '@/components/agent-bridge/types';

const CORE_ROLES = ['oracle', 'analyzer', 'evaluator', 'executor'] as const;
const REFRESH_MS = 30_000;
const STALE_MS = 20 * 60 * 1000;
const ARCSCAN_TX = 'https://testnet.arcscan.app/tx/';

type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };
type RelayerStatus = { ready?: boolean; relayerAddress?: string | null; usdcBalance?: string | null };
type ProtectedStatus = { protected: boolean; status: number | null };
type MarketStatus = { market: boolean; orderbook: boolean; candles: boolean };

type StatusState = {
  session: BridgeSession | null;
  relayer: RelayerStatus | null;
  protectedAccess: ProtectedStatus;
  market: MarketStatus;
};

function formatAge(iso?: string | null) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'unknown';
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ${min % 60}m ago`;
}

function latestUpdatedAt(session: BridgeSession | null) {
  const timestamps = [...(session?.events ?? []), ...(session?.receipts ?? [])]
    .map((item) => new Date(item.created_at).getTime())
    .filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function StatusPill({ state }: { state: 'Online' | 'Stale' | 'Unavailable' | 'Ready' | 'Not Ready' | 'Protected' }) {
  const good = state === 'Online' || state === 'Ready' || state === 'Protected';
  return (
    <span className={`rounded-full border px-2 py-1 font-mono text-[9px] uppercase ${good ? 'border-emerald-300/35 bg-emerald-400/10 text-emerald-300' : state === 'Stale' ? 'border-amber-300/35 bg-amber-400/10 text-amber-200' : 'border-red-300/30 bg-red-400/10 text-red-200'}`}>
      {state}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">{title}</div>
      {children}
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'strong' | 'muted' }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-white/10 py-2 first:border-t-0">
      <span className="text-xs text-[#EAE4D8]/50">{label}</span>
      <span className={`text-right font-mono text-xs ${tone === 'strong' ? 'text-[#C5A67C]' : tone === 'muted' ? 'text-[#EAE4D8]/35' : 'text-[#F5F0E5]'}`}>{value}</span>
    </div>
  );
}

async function okFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, { cache: 'no-store', ...init });
  return res;
}

export default function StatusPage() {
  const [state, setState] = useState<StatusState>({
    session: null,
    relayer: null,
    protectedAccess: { protected: false, status: null },
    market: { market: false, orderbook: false, candles: false },
  });
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string>('—');

  useEffect(() => {
    let alive = true;
    async function load() {
      const now = new Date().toLocaleString();
      try {
        const [sessionRes, relayerRes, protectedRes, marketRes, orderbookRes, candlesRes] = await Promise.allSettled([
          okFetch('/api/agent-bridge/sessions/latest'),
          okFetch('/api/x402/relayer-status'),
          okFetch('/api/x402/bridge-access?rail=arc-native-eoa', { method: 'POST' }),
          okFetch('/api/data/polymarket/btc-15m'),
          okFetch('/api/data/polymarket/btc-15m/orderbook'),
          okFetch('/api/data/polymarket/btc-15m/candles'),
        ]);
        if (!alive) return;

        let session: BridgeSession | null = null;
        let nextError: string | null = null;
        if (sessionRes.status === 'fulfilled') {
          const data = (await sessionRes.value.json().catch(() => null)) as LatestResponse | null;
          if (sessionRes.value.ok && data?.ok) session = data.session;
          else nextError = data?.message || data?.error || 'latest_session_unavailable';
        } else {
          nextError = sessionRes.reason instanceof Error ? sessionRes.reason.message : 'latest_session_unavailable';
        }

        const relayer = relayerRes.status === 'fulfilled'
          ? ((await relayerRes.value.json().catch(() => null)) as RelayerStatus | null)
          : null;
        const protectedStatus = protectedRes.status === 'fulfilled' ? protectedRes.value.status : null;

        setState({
          session,
          relayer,
          protectedAccess: { protected: protectedStatus === 402, status: protectedStatus },
          market: {
            market: marketRes.status === 'fulfilled' && marketRes.value.ok,
            orderbook: orderbookRes.status === 'fulfilled' && orderbookRes.value.ok,
            candles: candlesRes.status === 'fulfilled' && candlesRes.value.ok,
          },
        });
        setCheckedAt(now);
        setError(nextError);
      } catch (err) {
        if (alive) {
          setCheckedAt(now);
          setError(err instanceof Error ? err.message : 'network_error');
        }
      }
    }
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const session = state.session;
  const latestAt = latestUpdatedAt(session);
  const latestX402 = [...(session?.receipts ?? [])].reverse().find((r) => r.receipt_type === 'x402_arc_native' && r.transaction) ?? null;
  const dryRunCount = session?.receipts.filter((r) => r.receipt_type === 'dry_run').length ?? 0;
  const arcNativeCount = session?.receipts.filter((r) => r.receipt_type === 'x402_arc_native').length ?? 0;
  const sessionOnline = Boolean(session && latestAt && Date.now() - new Date(latestAt).getTime() <= STALE_MS);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1180px] flex-col gap-5 pt-8 pb-12 sm:pt-12">
        <header className="rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">ARCLAYER · READ-ONLY LIVE MONITOR</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5]">Live Production Status</h1>
              <p className="mt-2 max-w-3xl text-sm text-[#EAE4D8]/70">Real-time status for external PM2 agents, x402 access, market data, receipts, and proof history.</p>
            </div>
            <Link href="/live-a2a-agent/proof" className="md:ml-auto rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">Proof History →</Link>
          </div>
          <div className="mt-4 rounded-sm border border-white/10 bg-black/25 p-3 font-mono text-[11px] text-[#EAE4D8]/55">last checked: <span className="text-[#C5A67C]">{checkedAt}</span> · auto-refresh: <span className="text-[#C5A67C]">30s</span></div>
        </header>

        {error ? <div className="rounded-sm border border-amber-400/25 bg-amber-950/20 p-4 text-sm text-amber-100">Latest session unavailable: {error}</div> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Latest Session">
            <div className="mb-2 flex justify-end"><StatusPill state={sessionOnline ? 'Online' : session ? 'Stale' : 'Unavailable'} /></div>
            <Row label="sessionId" value={shortHash(session?.sessionId)} tone="strong" />
            <Row label="events count" value={session?.events.length ?? 0} />
            <Row label="receipts count" value={session?.receipts.length ?? 0} />
            <Row label="last updated" value={formatAge(latestAt)} />
          </Card>

          <Card title="PM2 Agents">
            <div className="space-y-1">
              {CORE_ROLES.map((role) => {
                const event = session?.roles?.[role] ?? null;
                const seenAt = event?.created_at ? new Date(event.created_at).getTime() : 0;
                const online = Boolean(event && Number.isFinite(seenAt) && Date.now() - seenAt <= STALE_MS);
                return (
                  <div key={role} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-white/10 py-2 first:border-t-0">
                    <span className="font-mono text-xs uppercase text-[#F5F0E5]">{role}</span>
                    <span className="text-xs text-[#EAE4D8]/50">{formatAge(event?.created_at)}</span>
                    <StatusPill state={online ? 'Online' : event ? 'Stale' : 'Unavailable'} />
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="x402 Relayer">
            <div className="mb-2 flex justify-end"><StatusPill state={state.relayer?.ready ? 'Ready' : 'Not Ready'} /></div>
            <Row label="relayer address" value={shortHash(state.relayer?.relayerAddress)} tone="strong" />
            <Row label="USDC balance" value={state.relayer?.usdcBalance ? `${state.relayer.usdcBalance} USDC` : '—'} />
          </Card>

          <Card title="x402 Protected Access">
            <div className="mb-2 flex justify-end"><StatusPill state={state.protectedAccess.protected ? 'Protected' : 'Unavailable'} /></div>
            <Row label="endpoint" value="/api/x402/bridge-access" tone="strong" />
            <Row label="without payment" value={state.protectedAccess.status ?? '—'} />
            <Row label="expected live state" value="402 Payment Required" />
            <Row label="label" value={state.protectedAccess.protected ? 'Protected' : 'Unavailable'} />
          </Card>

          <Card title="Market Data">
            <Row label="BTC 15m market" value={<StatusPill state={state.market.market ? 'Online' : 'Unavailable'} />} />
            <Row label="orderbook" value={<StatusPill state={state.market.orderbook ? 'Online' : 'Unavailable'} />} />
            <Row label="candles" value={<StatusPill state={state.market.candles ? 'Online' : 'Unavailable'} />} />
          </Card>

          <Card title="Receipts">
            <Row label="dry_run count" value={dryRunCount} />
            <Row label="x402_arc_native count" value={arcNativeCount} />
            <Row label="latest x402 tx" value={shortHash(latestX402?.transaction)} tone="strong" />
            <Row label="ArcScan link" value={latestX402?.transaction ? <a href={`${ARCSCAN_TX}${latestX402.transaction}`} target="_blank" rel="noreferrer" className="text-[#C5A67C] underline-offset-4 hover:underline">open ↗</a> : '—'} />
          </Card>
        </div>
      </div>
    </main>
  );
}
