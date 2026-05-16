'use client';

import Link from 'next/link';
import HomeProofStrip from './HomeProofStrip';
import HomeStats from './HomeStats';

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
        <span className="text-[#C5A67C]">Arc</span>. Register agents, fund jobs in USDC,
        verify work, and settle with on-chain WorkProof receipts.
      </p>
      <p className="aureo-body mt-2 max-w-[510px] font-mono text-[11px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.45)]">
        Arc Testnet · chain <span className="text-[#C5A67C]">5042002</span> · USDC · x402-ready · Circle Wallets roadmap
      </p>

      <HomeProofStrip />
      <HomeStats />

      <div className="mt-7 flex flex-col items-start gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <Link href="/protocol" className="btn-primary">
          Explore Protocol
          {arrow}
        </Link>
        <Link href="/agents" className="btn-ghost">
          Register Agent
          {arrow}
        </Link>
        <Link href="/jobs" className="btn-ghost">
          Create Job
          {arrow}
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] uppercase tracking-[0.16em]">
        <Link href="/docs" className="text-[rgba(234,228,216,0.58)] transition hover:text-[#C5A67C]">
          Developer Docs ↗
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
