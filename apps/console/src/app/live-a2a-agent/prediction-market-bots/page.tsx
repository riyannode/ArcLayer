'use client';

import Link from 'next/link';
import { BtcCandlestickPanel, PolymarketBtc15mPanel, PolymarketOrderbookPanel } from '@/components/market/PolymarketPanels';

export default function PredictionMarketBotsPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-6 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
        <header className="rounded-md border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Agent Bridge</Link>
          <h1 className="mt-3 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5]">Prediction Market Bots</h1>
          <p className="mt-2 text-sm text-[#EAE4D8]/70">Live Polymarket BTC/ETH UpDown 15m monitor with decision and receipt placeholders (no live execution).</p>
        </header>
        <section className="grid gap-3 lg:grid-cols-3"><PolymarketBtc15mPanel /><PolymarketOrderbookPanel /><BtcCandlestickPanel /></section>
      </div>
    </main>
  );
}
