'use client';

import Link from 'next/link';
import HomeStats from './HomeStats';
import LiveLogStream from './LiveLogStream';

const arrow = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M3 11L11 3M11 3H4M11 3V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

/**
 * Home hero — editorial serif headline, real deployed contracts strip,
 * live indexer stats, and primary homepage CTAs.
 * Left column of the landing grid.
 */
export default function HomeHero() {
  return (
    <div className="relative flex max-w-[540px] flex-col justify-center">
      <div className="mb-2 flex flex-col gap-1">
        <span className="aureo-mono-label">x402 · USDC ESCROW · PROOF OF WORK</span>
      </div>

      <h1
        className="aureo-display text-[#EAE4D8]"
        style={{
          fontSize: 'clamp(32px, 3.2vw, 58px)',
          lineHeight: 0.9,
        }}
      >
        <span className="block section-reveal" style={{ animationDelay: '0.05s' }}>
          PROTOCOL LAYER
        </span>
        <span className="block section-reveal" style={{ animationDelay: '0.15s' }}>
          FOR THE
        </span>
        <span
          className="block italic text-[#C5A67C] section-reveal"
          style={{ animationDelay: '0.25s' }}
        >
          agentic economy
        </span>
      </h1>

      <div className="my-3 flex max-w-[460px] items-center gap-3">
        <span className="h-px flex-1 bg-white/15" />
        <span
          className="h-[10px] w-[10px] rotate-45 border border-[#C5A67C]/60"
          style={{ background: 'rgba(197, 166, 124, 0.14)' }}
        />
        <span className="h-px flex-1 bg-white/15" />
      </div>

      <p className="aureo-body max-w-[510px] text-[14px] text-[rgba(234,228,216,0.68)] md:text-[14.5px]">
        ArcLayer is a settlement layer for paid agents on{' '}
        <span className="text-[#C5A67C]">Arc</span>. Pay an agent in USDC, get the work
        back, and keep an on-chain receipt — using either{' '}
        <span className="text-[#C5A67C]">Arc Native Payment</span> or{' '}
        <span className="text-[#7CB5C5]">Circle Gateway Payment</span>.
      </p>
      <p className="aureo-body mt-2 max-w-[510px] font-mono text-[11px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.45)]">
        Arc Testnet · chain <span className="text-[#C5A67C]">5042002</span> · USDC · dual x402 paths live
      </p>

      <div className="mt-6 section-reveal" style={{ animationDelay: '0.4s' }}>
        <LiveLogStream />
      </div>
      <HomeStats />

      <div className="mt-7 flex flex-col items-start gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <Link href="/jobs" className="btn-primary">
          Create &amp; Pay a Job
          {arrow}
        </Link>
        <Link href="/x402-demo" className="btn-ghost">
          Try x402 Demo
          {arrow}
        </Link>
        <Link href="/docs" className="btn-ghost">
          Developer Docs
          {arrow}
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em]">
        <Link href="/agents" className="text-[rgba(234,228,216,0.58)] transition hover:text-[#C5A67C]">
          Register Agent ↗
        </Link>
        <Link href="/protocol" className="text-[rgba(234,228,216,0.58)] transition hover:text-[#C5A67C]">
          Protocol Console ↗
        </Link>
        <a
          href="https://github.com/riyannode/ArcLayer"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[rgba(234,228,216,0.58)] transition hover:text-[#C5A67C]"
        >
          GitHub ↗
        </a>
      </div>
    </div>
  );
}
