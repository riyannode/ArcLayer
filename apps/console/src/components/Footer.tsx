'use client';

import Link from 'next/link';
import ArcMark from './ArcMark';

export default function Footer() {
  const protocolLinks = [
    { label: 'PROTOCOL', href: '/protocol' },
    { label: 'JOBS', href: '/jobs' },
    { label: 'AGENTS', href: '/agents' },
    { label: 'SDK', href: '/docs' },
  ];

  const resourceLinks = [
    { label: 'Github', href: 'https://github.com/riyannode/ArcLayer', ext: true },
    { label: 'RPC', href: 'https://rpc.drpc.testnet.arc.network', ext: true },
    { label: 'Explorer', href: 'https://testnet.arcscan.app', ext: true },
    { label: 'Circle · Arc', href: 'https://arc.circle.com', ext: true },
  ];

  return (
    <footer className="relative z-10 w-full border-t border-white/8" style={{ background: 'rgba(5, 5, 5, 0.92)' }}>
      <div className="mx-auto max-w-screen-2xl px-6 py-16 md:px-10">
        {/* CTA strip */}
        <div
          className="mb-12 flex flex-col gap-6 p-8 md:flex-row md:items-center md:justify-between"
          style={{ border: '1px solid transparent' }}
          aria-hidden="true"
        >
          <div>
            <div className="aureo-mono-label mb-3">&nbsp;</div>
            <p className="aureo-display text-[28px] md:text-[34px]" style={{ color: 'transparent' }}>
              &nbsp;
            </p>
            <p className="mt-2 font-mono text-[12px]" style={{ color: 'transparent' }}>
              &nbsp;
            </p>
          </div>
          <div className="flex gap-3" />
        </div>

        {/* Columns */}
        <div className="mt-4 grid grid-cols-1 gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <ArcMark size={28} />
              <span className="aureo-body text-[#EAE4D8]" style={{ fontSize: '16px', letterSpacing: '0.24em', fontWeight: 400 }}>
                ARCLAYER
              </span>
            </div>
            <p className="mt-5 max-w-[360px] font-mono text-[11.5px] leading-6 text-[#a0a0a0]">
                  x402 payment, USDC escrow, and WorkProof reputation infrastructure for agent builders and developers — on Arc.
            </p>
            <div className="mt-6 flex items-center gap-2">
              <span className="pulse-dot" />
              <span className="font-mono text-[10px] tracking-[0.18em] text-[#B8CD7E]">
                INDEXER · LIVE
              </span>
            </div>
          </div>

          <div>
            <div className="aureo-mono-label mb-4">PROTOCOL</div>
            <ul className="space-y-2.5">
              {protocolLinks.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="font-mono text-[11px] tracking-[0.16em] text-[#c5c0b2] transition-colors hover:text-[#C5A67C]">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="aureo-mono-label mb-4">RESOURCES</div>
            <ul className="space-y-2.5">
              {resourceLinks.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    target={l.ext ? '_blank' : undefined}
                    rel={l.ext ? 'noopener noreferrer' : undefined}
                    className="font-mono text-[11px] text-[#c5c0b2] transition-colors hover:text-[#C5A67C]"
                  >
                    {l.label} <span className="text-[#a0a0a0]">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="aureo-mono-label mb-4">NETWORK</div>
            <div className="space-y-3">
              <div>
                <div className="aureo-mono-label" style={{ fontSize: '9px' }}>CHAIN</div>
                <div className="mt-0.5 font-mono text-[11px] text-[#EAE4D8]">Arc Testnet</div>
              </div>
              <div>
                <div className="aureo-mono-label" style={{ fontSize: '9px' }}>CHAIN ID</div>
                <div className="mt-0.5 font-mono text-[11px] text-[#EAE4D8]">5042002</div>
              </div>
              <div>
                <div className="aureo-mono-label" style={{ fontSize: '9px' }}>SETTLEMENT</div>
                <div className="mt-0.5 font-mono text-[11px] text-[#C5A67C]">USDC (testnet)</div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div className="mt-12 flex items-center justify-center border-t border-transparent pt-8">
          <p className="font-mono text-[10.5px] tracking-[0.12em] text-[#a0a0a0]">
            © 2026 ARCLAYER · PAYMENT INFRASTRUCTURE FOR AGENTS READY TO SHIP
          </p>
        </div>
      </div>
    </footer>
  );
}
