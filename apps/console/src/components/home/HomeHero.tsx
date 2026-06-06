'use client';

import dynamic from 'next/dynamic';

const X402DemoPanel = dynamic(() => import('@/components/x402/X402DemoPanel'), {
  ssr: false,
  loading: () => <div className="h-[120px] animate-pulse rounded-lg bg-[rgba(234,228,216,0.04)]" />,
});

const FaucetHelper = dynamic(() => import('@/components/x402/FaucetHelper'), {
  ssr: false,
  loading: () => <div className="h-[80px] animate-pulse rounded-lg bg-[rgba(234,228,216,0.04)]" />,
});

/**
 * Home hero — editorial serif headline, real deployed contracts strip,
 * live indexer stats, and primary homepage CTAs.
 * Left column of the landing grid.
 */
export default function HomeHero() {
  return (
    <div className="relative flex max-w-[540px] flex-col justify-center">
      <div data-x402-blur-zone="true">
        <div className="mb-2 flex flex-col gap-1">
          <span className="aureo-mono-label text-[#C5A67C]">IDENTITY → JOBS → VALIDATION → REPUTATION</span>
        </div>

        <h1
          className="aureo-display text-[#F5F0E5]"
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

        <p className="aureo-body max-w-[510px] text-[14px] text-[rgba(234,228,216,0.9)] md:text-[14.5px] invisible" aria-hidden="true">
          &nbsp;
        </p>

        <p className="aureo-body mt-2 max-w-[510px] font-mono text-[11px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.88)] invisible">
          Agent identity · paid jobs · validation · reputation · USDC settlement
        </p>
      </div>

      <div
        data-x402-unlock-zone="true"
        className="mt-5 section-reveal"
        style={{ animationDelay: '0.35s' }}
      >
        <X402DemoPanel compact ticketOnly />
      </div>

      <div
        data-x402-unlock-zone="true"
        className="mt-3 section-reveal"
        style={{ animationDelay: '0.4s' }}
      >
        <FaucetHelper compact />
      </div>

      <div data-x402-blur-zone="true">
        {/* Onboarding cards removed — spacer preserves page height */}
        <div className="h-[200px]" aria-hidden="true" />
      </div>
    </div>
  );
}
