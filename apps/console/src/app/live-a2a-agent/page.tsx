'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AgentBridgeFlowDiagram, AgentBridgeSessionPanel, BridgeReceiptsPanel, ExternalJobsPanel, type BridgeSession } from '@/components/agent-bridge';
import { RegisteredAgentsList } from '@/components/a2a/RegisteredAgentsList';
import { AGENT_CATEGORIES } from './categories';
import { BtcCandlestickPanel, PolymarketBtc15mPanel, PolymarketOrderbookPanel } from '@/components/market/PolymarketPanels';

type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };
type PaymentResponse = { mode?: string; paymentId?: string; transaction?: string; amount?: string; payer?: string; sessionId?: string };

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#C5A67C]">{children}</span>;
}

function decodePaymentResponse(raw: string | null): PaymentResponse | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed as PaymentResponse : null;
  } catch {
    try {
      const decoded = atob(raw);
      const parsed = JSON.parse(decoded);
      return typeof parsed === 'object' && parsed ? parsed as PaymentResponse : null;
    } catch {
      return null;
    }
  }
}

export default function LiveA2AAgentPage() {
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessStatus, setAccessStatus] = useState<string>('protected endpoint status: x402 payment required');
  const [paymentResponse, setPaymentResponse] = useState<PaymentResponse | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/agent-bridge/sessions/latest', { cache: 'no-store' });
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
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  async function checkProtectedEndpoint() {
    setAccessStatus('checking /api/x402/bridge-access…');
    setPaymentResponse(null);
    try {
      const res = await fetch('/api/x402/bridge-access?rail=arc-native-eoa', { method: 'POST' });
      const header = res.headers.get('PAYMENT-RESPONSE') || res.headers.get('X-PAYMENT-RESPONSE');
      setPaymentResponse(decodePaymentResponse(header));
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setAccessStatus('x402 payment required; no unlock claimed without X-PAYMENT');
        return;
      }
      if (!res.ok || data.ok === false) {
        setAccessStatus(data.error || data.message || `protected endpoint returned ${res.status}`);
        return;
      }
      const response = decodePaymentResponse(header) || data.paymentResponse || null;
      setPaymentResponse(response);
      setAccessStatus(response?.transaction ? 'payment response received' : 'protected endpoint reachable');
    } catch (err) {
      setAccessStatus(err instanceof Error ? err.message : 'protected endpoint check failed');
    }
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-5 pt-8 pb-12 sm:pt-12">
        <header className="overflow-hidden rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90">
          <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">ARCLAYER · EXTERNAL AGENT RUNTIME</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5] sm:text-4xl">A2A AGENT BRIDGE</h1>
              <p className="mt-2 max-w-4xl text-sm text-[#EAE4D8]/70">External agents run anywhere. ArcLayer handles x402 access, bridge events, receipts, payload hashes, and proof history on Arc.</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Chip>Bridge Events</Chip>
              <Chip>Receipts</Chip>
              <Chip>Payload Hash</Chip>
              <Chip>x402 Access</Chip>
            </div>
          </div>
          <div className="grid gap-px bg-white/10 md:grid-cols-4">
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Events</div><div className="font-mono text-lg text-[#C5A67C]">{session?.events.length ?? 0}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Receipts</div><div className="font-mono text-lg text-emerald-300">{session?.receipts.length ?? 0}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Roles</div><div className="font-mono text-lg text-[#D7C7AA]">{Object.keys(session?.roles ?? {}).length}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">x402 Access</div><div className="font-mono text-lg text-[#C5A67C]">Protected</div></div>
          </div>
        </header>

        <section className="grid gap-3 lg:grid-cols-3">
          <PolymarketBtc15mPanel />
          <PolymarketOrderbookPanel />
          <BtcCandlestickPanel />
        </section>

        <section className="rounded-sm border border-white/10 bg-black/25 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">x402 Protected Endpoint Status</div>
            <button onClick={checkProtectedEndpoint} className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">Check Status</button>
          </div>
          <div className="rounded-sm border border-white/10 bg-black/30 p-3 font-mono text-[10px] text-[#EAE4D8]/55">status: {accessStatus}</div>
          {paymentResponse ? (
            <div className="mt-3 grid gap-2 text-xs text-[#EAE4D8]/60 sm:grid-cols-2 lg:grid-cols-3">
              {(['mode', 'paymentId', 'transaction', 'amount', 'payer', 'sessionId'] as const).map((key) => (
                <div key={key}>{key}: <span className="font-mono text-[#C5A67C]">{paymentResponse[key] || '—'}</span></div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-sm border border-white/10 bg-black/25 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Agent Categories</div>
            <Link href="/register/autonomous" className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">Register Agent →</Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {AGENT_CATEGORIES.map((category) => (
              <Link key={category.key} href={`/live-a2a-agent/${category.key}`} className="rounded-sm border border-white/10 bg-white/[0.03] p-3 transition hover:border-[#C5A67C]/35 hover:bg-[#C5A67C]/[0.04]">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-[#F5F0E5]">{category.label}</div>
                  <span className="rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] text-emerald-300">{category.status}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <RegisteredAgentsList categoryKey="custom-workers" categoryLabel="Registered External Agents" />
        <ExternalJobsPanel title="Available Jobs" />
        <AgentBridgeSessionPanel session={session} error={error} />
        <AgentBridgeFlowDiagram session={session} />
        <BridgeReceiptsPanel session={session} />
      </div>
    </main>
  );
}
