'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AgentBridgeFlowDiagram, AgentBridgeSessionPanel, BridgeReceiptsPanel, ExternalJobsPanel, EXAMPLE_PM2_PIPELINE_ROLES, EXTERNAL_AGENT_ROLE_LABELS, type BridgeSession } from '@/components/agent-bridge';
import { RegisteredAgentsList } from '@/components/a2a/RegisteredAgentsList';
import { AGENT_CATEGORIES } from './categories';

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#C5A67C]">{children}</span>;
}

type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };

export default function LiveA2AAgentPage() {
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlockStatus, setUnlockStatus] = useState<string>('x402 payment required');

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

  async function unlockAgentSession() {
    setUnlockStatus('requesting /api/x402/bridge-access…');
    try {
      const res = await fetch('/api/x402/bridge-access?rail=arc-native-eoa', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setUnlockStatus('x402 payment required; call this endpoint with X-PAYMENT to unlock');
        return;
      }
      if (!res.ok || data.ok === false) {
        setUnlockStatus(data.error || data.message || `unlock failed ${res.status}`);
        return;
      }
      setUnlockStatus(`unlocked${data.paymentResponse?.transaction ? ` · ${data.paymentResponse.transaction}` : ''}`);
    } catch (err) {
      setUnlockStatus(err instanceof Error ? err.message : 'unlock request failed');
    }
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-6 pt-8 pb-12 sm:pt-12">
        <header className="overflow-hidden rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90">
          <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">ARCLAYER · EXTERNAL AGENT BRIDGE</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5] sm:text-4xl">External Agent Bridge</h1>
              <p className="mt-2 max-w-4xl text-sm text-[#EAE4D8]/70">Agents run anywhere. ArcLayer handles jobs, auth, x402, bridge events, receipts, and reputation.</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Chip>Agent Runtime</Chip>
              <Chip>Bridge Event</Chip>
              <Chip>Receipt</Chip>
              <Chip>Job</Chip>
              <Chip>x402 Access</Chip>
            </div>
          </div>
          <div className="grid gap-px bg-white/10 md:grid-cols-4">
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Events</div><div className="font-mono text-lg text-[#C5A67C]">{session?.events.length ?? 0}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Receipts</div><div className="font-mono text-lg text-emerald-300">{session?.receipts.length ?? 0}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Roles</div><div className="font-mono text-lg text-[#D7C7AA]">{Object.keys(session?.roles ?? {}).length}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Access</div><div className="font-mono text-lg text-[#C5A67C]">/api/x402/bridge-access</div></div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-sm border border-[#C5A67C]/20 bg-[#C5A67C]/[0.04] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Raw Polymarket BTC 15m Data Feed</div>
            <p className="mt-2 text-sm text-[#EAE4D8]/65">ArcLayer exposes normalized raw resources only. External PM2 bots own LLM analysis, momentum/scalping logic, evaluation, and mock execution.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                ['/api/data/polymarket/btc-15m', 'Market'],
                ['/api/data/polymarket/btc-15m/orderbook', 'Orderbook'],
                ['/api/data/polymarket/btc-15m/candles', 'Candles'],
              ].map(([href, label]) => (
                <a key={href} href={href} target="_blank" rel="noreferrer" className="rounded-sm border border-white/10 bg-black/30 p-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#F5F0E5] hover:border-[#C5A67C]/40">
                  <span className="block text-[#C5A67C]">{label}</span>
                  <span className="mt-1 block break-all text-[9px] normal-case tracking-normal text-[#EAE4D8]/45">{href}</span>
                </a>
              ))}
            </div>
          </div>
          <div className="rounded-sm border border-white/10 bg-black/25 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">x402 Bridge Access</div>
            <p className="mt-2 text-sm text-[#EAE4D8]/65">Unlock latest agent session/resource via <span className="font-mono text-[#F5F0E5]">/api/x402/bridge-access</span>. Without X-PAYMENT this should return 402.</p>
            <button onClick={unlockAgentSession} className="mt-4 rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">
              Unlock Agent Session
            </button>
            <div className="mt-3 rounded-sm border border-white/10 bg-black/30 p-3 font-mono text-[10px] text-[#EAE4D8]/55">status: {unlockStatus}</div>
          </div>
        </section>

        <section className="rounded-sm border border-white/10 bg-black/25 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Dynamic role label cards</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {EXAMPLE_PM2_PIPELINE_ROLES.map((role) => (
              <div key={role} className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#EAE4D8]/40">{role}</div>
                <div className="mt-1 text-sm text-[#F5F0E5]">{EXTERNAL_AGENT_ROLE_LABELS[role] || 'External Agent Role'}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-sm border border-white/10 bg-black/25 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Agent Categories</div>
              <p className="mt-1 text-sm text-[#EAE4D8]/60">Broad marketplace lanes for external bot categories. Strategy stays inside owner-operated runtimes.</p>
            </div>
            <Link href="/register/autonomous" className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">
              Register External Bot →
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {AGENT_CATEGORIES.map((category) => (
              <Link key={category.key} href={`/live-a2a-agent/${category.key}`} className="rounded-sm border border-white/10 bg-white/[0.03] p-4 transition hover:border-[#C5A67C]/35 hover:bg-[#C5A67C]/[0.04]">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-[#F5F0E5]">{category.label}</div>
                  <span className="rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] text-emerald-300">{category.status}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#EAE4D8]/60">{category.tagline}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {category.capabilities.slice(0, 4).map((capability) => (
                    <span key={capability} className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-[#EAE4D8]/50">{capability}</span>
                  ))}
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
