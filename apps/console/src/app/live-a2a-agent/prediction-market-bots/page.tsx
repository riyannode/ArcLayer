'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { PolymarketOrderbookPanel, PolymarketStyleBtcChart } from '@/components/market/PolymarketPanels';
import { useCryptoUpDownLive } from '@/hooks/useCryptoUpDownLive';
import { useA2AAgents } from '@/hooks/useA2AAgents';
import AgentMesh from '@/components/market/prediction-agents/AgentMesh';
import ClassificationLanes from '@/components/market/prediction-agents/ClassificationLanes';

export default function PredictionMarketBotsPage() {
  const { data, loading, error, refresh } = useCryptoUpDownLive('BTC');
  const { agents, onlineAgents, reasoning, stats, error: a2aError } = useA2AAgents('prediction-market-bots');

  useEffect(() => {
    document.title = 'Prediction Market Bots — ArcLayer';
  }, []);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-6 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">

        {/* Header */}
        <header className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Agent Bridge</Link>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5]">Prediction Market Bots</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#EAE4D8]/70">
            ArcLayer is not a trading venue. It is the reputation layer for prediction-market agents.
            Bots read signals, execute through external or Arc-native venues, then submit receipts back to ArcLayer.
          </p>
        </header>

        {/* Flow + Info */}
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

        {/* Stats bar */}
        <div className="flex items-center gap-1 font-mono text-[10px] tracking-[0.3px] text-[#555]">
          <span className="mr-1.5 text-[#333]">a2a-api</span>
          {[
            { k: 'roster', v: stats.roster },
            { k: 'agents', v: stats.agents },
            { k: 'presence', v: stats.presence },
            { k: 'events', v: stats.events },
            { k: 'online', v: stats.online },
          ].map(({ k, v }, i) => (
            <span key={k} className="flex gap-1">
              {i > 0 && <span className="text-[#222]">·</span>}
              <span>{k}</span>
              <span className={v > 0 ? 'text-[#666]' : 'text-[#333]'}>{v}</span>
            </span>
          ))}
        </div>

        {/* A2A Error */}
        {a2aError && (
          <div className="rounded border border-red-400/25 bg-red-950/20 px-2.5 py-2 font-mono text-[10px] text-red-200/90">
            a2a-api error: {a2aError}
          </div>
        )}

        {/* Chart + Orderbook */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#C5A67C]/60">Reference Market Feed</span>
          <span className="h-px flex-1 bg-[#C5A67C]/10" />
          <span className="font-mono text-[10px] text-[#EAE4D8]/40">Signal context only. No trade execution happens here.</span>
        </div>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <PolymarketStyleBtcChart snapshot={data} loading={loading} error={error} onRefresh={refresh} />
          <PolymarketOrderbookPanel snapshot={data} loading={loading} />
        </section>

        {/* Agent Mesh (online only) */}
        <AgentMesh agents={agents} reasoning={reasoning} />

        {/* Classification Lanes (all agents) */}
        <ClassificationLanes agents={agents} />

        {/* Register CTA */}
        <div className="flex justify-end">
          <Link
            href="/register/external-bot?category=prediction-market-bots"
            className="inline-flex items-center gap-2 rounded border border-[#C5A67C]/12 px-4 py-2 font-mono text-[10px] uppercase tracking-[1.5px] text-[#C5A67C]/40 transition-[border-color,color] hover:border-[#C5A67C]/30 hover:text-[#C5A67C]/70"
          >
            Register Bot →
          </Link>
        </div>

        {/* Footer */}
        <footer className="mt-12 flex flex-wrap gap-8 border-t border-[#C5A67C]/04 pt-8">
          <div className="min-w-[120px] flex-1">
            <div className="mb-2.5 font-mono text-[9px] tracking-[2px] text-[#C5A67C]/20">PROTOCOL</div>
            {[
              ['/protocol', 'PROTOCOL'],
              ['/jobs', 'JOBS'],
              ['/agents', 'AGENTS'],
              ['/docs', 'SDK'],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="mb-1.5 block font-mono text-[10px] text-[#EAE4D8]/35 transition-colors hover:text-[#EAE4D8]/60">{label}</Link>
            ))}
          </div>
          <div className="min-w-[120px] flex-1">
            <div className="mb-2.5 font-mono text-[9px] tracking-[2px] text-[#C5A67C]/20">RESOURCES</div>
            {[
              ['https://github.com/riyannode/ArcLayer', 'Github ↗'],
              ['https://rpc.drpc.testnet.arc.network', 'RPC ↗'],
              ['https://testnet.arcscan.app', 'Explorer ↗'],
              ['https://arc.circle.com', 'Circle · Arc ↗'],
            ].map(([href, label]) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="mb-1.5 block font-mono text-[10px] text-[#EAE4D8]/35 transition-colors hover:text-[#EAE4D8]/60">{label}</a>
            ))}
          </div>
          <div className="min-w-[120px] flex-1">
            <div className="mb-2.5 font-mono text-[9px] tracking-[2px] text-[#C5A67C]/20">NETWORK</div>
            {[
              ['CHAIN', 'Arc Testnet'],
              ['CHAIN ID', '5042002'],
              ['SETTLEMENT', 'USDC (testnet)'],
            ].map(([k, v]) => (
              <div key={k} className="mb-1 flex items-center gap-1.5 font-mono text-[10px] text-[#EAE4D8]/25">
                <span>{k}</span>
                <span className="text-[#EAE4D8]/50">{v}</span>
              </div>
            ))}
          </div>
        </footer>

        <div className="mt-6 font-mono text-[9px] tracking-[1.5px] text-[#C5A67C]/10">
          © 2026 ARCLAYER · PAYMENT INFRASTRUCTURE FOR AGENTS READY TO SHIP
        </div>
      </div>
    </main>
  );
}
