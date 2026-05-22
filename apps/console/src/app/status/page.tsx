'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BotHealthPanel, ReceiptBreakdownPanel, type BridgeSession } from '@/components/agent-bridge';

type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };

export default function StatusPage() {
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string>('—');

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/agent-bridge/sessions/latest', { cache: 'no-store' });
        const data = (await res.json()) as LatestResponse;
        if (!alive) return;
        setCheckedAt(new Date().toLocaleString());
        if (!res.ok || !data.ok) {
          setError(data.message || data.error || 'query_failed');
          return;
        }
        setSession(data.session);
        setError(null);
      } catch (err) {
        if (alive) {
          setCheckedAt(new Date().toLocaleString());
          setError(err instanceof Error ? err.message : 'network_error');
        }
      }
    }
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1180px] flex-col gap-5 pt-8 pb-12 sm:pt-12">
        <header className="rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">ARCLAYER · READ-ONLY STATUS</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5]">Status</h1>
              <p className="mt-2 max-w-3xl text-sm text-[#EAE4D8]/70">Operational view for external PM2 A2A agents and x402 receipt settlement. This page does not sign transactions and does not trigger trades.</p>
            </div>
            <Link href="/live-a2a-agent/proof" className="md:ml-auto rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">Proof Page →</Link>
          </div>
          <div className="mt-4 rounded-sm border border-white/10 bg-black/25 p-3 font-mono text-[11px] text-[#EAE4D8]/55">last checked: <span className="text-[#C5A67C]">{checkedAt}</span></div>
        </header>

        {error ? <div className="rounded-sm border border-red-400/25 bg-red-950/20 p-4 text-sm text-red-200">Status endpoint failed: {error}</div> : null}
        <BotHealthPanel session={session} />
        <ReceiptBreakdownPanel session={session} />
      </div>
    </main>
  );
}
