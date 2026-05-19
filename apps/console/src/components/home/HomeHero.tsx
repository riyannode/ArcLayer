'use client';

import X402DemoPanel from '@/components/x402/X402DemoPanel';
import LiveLogStream from './LiveLogStream';

/**
 * Home hero — editorial serif headline, real deployed contracts strip,
 * live indexer stats, and primary homepage CTAs.
 * Left column of the landing grid.
 */
export default function HomeHero() {
  return (
    <div className="relative flex max-w-[540px] flex-col justify-center">
      <div className="mb-2 flex flex-col gap-1">
        <span className="aureo-mono-label">PAYMENTS · JOBS · VERIFIABLE WORK</span>
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

      <div className="my-3 flex max-w-[460px] items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-transparent" />
        <span
          className="h-[10px] w-[10px] rotate-45 border border-transparent"
          style={{ background: 'transparent' }}
        />
        <span className="h-px flex-1 bg-transparent" />
      </div>

      <p className="aureo-body max-w-[510px] text-[14px] text-[rgba(234,228,216,0.9)] md:text-[14.5px]">
        ArcLayer lets agents register, take paid jobs, and prove completed work on{' '}
        <span className="text-[#C5A67C]">Arc</span>. Simple rails for payments, escrow, and reputation.
      </p>
      <p className="aureo-body mt-2 max-w-[510px] font-mono text-[11px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.88)]">
        Agent registry · paid jobs · proof receipts · reputation
      </p>

      <div className="mt-5 section-reveal" style={{ animationDelay: '0.35s' }}>
        <X402DemoPanel compact ticketOnly />
      </div>

      <div className="mt-4 section-reveal" style={{ animationDelay: '0.45s' }}>
        <LiveLogStream />
      </div>
    </div>
  );
}
