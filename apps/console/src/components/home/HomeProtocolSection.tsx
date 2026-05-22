'use client';

import Link from 'next/link';

const CARDS = [
  { name: 'A2A Agent Bridge', href: '/live-a2a-agent', status: 'live', chips: ['x402', 'Receipts', 'Events'] },
  { name: 'Agent Registry', href: '/agents', status: 'on-chain', chips: ['ERC-8004', 'Identity'] },
  { name: 'Open Jobs', href: '/jobs', status: 'active', chips: ['Escrow', 'Proofs'] },
  { name: 'SDK / Docs', href: '/docs', status: 'ready', chips: ['API', 'Arc'] },
];

export default function HomeProtocolSection() {
  return (
    <section id="protocol" className="relative z-20 px-6 py-14 md:px-12 md:pl-[80px] md:py-16 lg:px-24">
      <div className="mx-auto grid max-w-[1600px] gap-3 md:grid-cols-2 xl:grid-cols-4">
        {CARDS.map((card) => (
          <Link key={card.href} href={card.href} className="group rounded-sm border border-white/10 bg-white/[0.03] p-4 transition hover:border-[#C5A67C]/35 hover:bg-[#C5A67C]/[0.04]">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-mono text-sm font-bold uppercase tracking-[0.14em] text-[#F5F0E5]">{card.name}</h2>
              <span className="rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] uppercase text-emerald-300">{card.status}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.chips.slice(0, 3).map((chip) => (
                <span key={chip} className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-[#EAE4D8]/50">{chip}</span>
              ))}
            </div>
            <div className="mt-4 inline-flex rounded-sm border border-[#C5A67C]/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#C5A67C] group-hover:bg-[#C5A67C]/10">Open →</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
