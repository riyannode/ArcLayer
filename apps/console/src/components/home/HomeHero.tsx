'use client';

import Link from 'next/link';
import HomeProofStrip from './HomeProofStrip';
import HomeStats from './HomeStats';

/**
 * Home hero — editorial serif headline, developer quickstart block,
 * CTAs, real deployed contracts strip, and live indexer stats.
 * Left column of the landing grid.
 *
 * Spacing tuned for 80–90% browser zoom (primary viewing target) while
 * staying usable at 100%. Headline uses clamp() so it scales continuously
 * with viewport width instead of jumping at breakpoints.
 */
export default function HomeHero() {
  return (
    <div className="relative flex max-w-[540px] flex-col justify-center">
      {/* Kicker */}
      <div className="mb-2.5 flex flex-col gap-1">
        <span className="aureo-mono-label">AGENTIC</span>
        <span className="aureo-mono-label">PROTOCOL</span>
      </div>

      {/* Headline — slogan (fluid, clamp-driven) */}
      <h1
        className="aureo-display text-[#EAE4D8]"
        style={{
          fontSize: 'clamp(34px, 3.6vw, 62px)',
          lineHeight: 0.9,
        }}
      >
        <span className="block section-reveal" style={{ animationDelay: '0.05s' }}>
          PROTOCOL
        </span>
        <span className="block section-reveal" style={{ animationDelay: '0.15s' }}>
          LAYER FOR THE
        </span>
        <span
          className="block italic text-[#C5A67C] section-reveal"
          style={{ animationDelay: '0.25s' }}
        >
          agentic economy
        </span>
      </h1>

      {/* Divider */}
      <div className="my-3.5 flex max-w-[460px] items-center gap-3">
        <span className="h-px flex-1 bg-white/15" />
        <span
          className="h-[10px] w-[10px] rotate-45 border border-[#C5A67C]/60"
          style={{ background: 'rgba(197, 166, 124, 0.14)' }}
        />
        <span className="h-px flex-1 bg-white/15" />
      </div>

      {/* Body */}
      <p className="aureo-body max-w-[510px] text-[14px] text-[#9a9a9a] md:text-[14.5px]">
        ArcLayer is a{' '}
        <span className="text-[#C5A67C]">settlement fabric for autonomous protocols</span>.
        Contract modules, a typed SDK, event indexing, and a console for inspecting jobs,
        escrow, and agent reputation — deployed on Arc (chain{' '}
        <span className="font-mono text-[#C5A67C]">5042002</span>).
      </p>

      {/* Developer quickstart */}
      <div className="mt-2.5 max-w-[500px]">
        <div className="aureo-mono-label mb-1.5">QUICKSTART</div>
        <pre className="code-block py-2.5">
<span className="tok-c"># install workspace SDK</span>{'\n'}
<span className="tok-k">pnpm</span> add @arclayer/sdk{'\n'}{'\n'}
<span className="tok-c">// read contract + query job</span>{'\n'}
<span className="tok-k">import</span> {'{ CONTRACTS, readJob }'} <span className="tok-k">from</span>{' '}
<span className="tok-s">&apos;@arclayer/sdk&apos;</span>;{'\n'}
<span className="tok-k">const</span> job = <span className="tok-k">await</span> readJob(<span className="tok-s">0n</span>);
        </pre>
      </div>

      {/* CTAs */}
      <div className="mt-3.5 flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:gap-3">
        <Link href="/dashboard" className="btn-primary">
          OPEN PROTOCOL CONSOLE
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 11L11 3M11 3H4M11 3V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </Link>
        <Link href="/docs" className="btn-ghost">
          READ SDK DOCS
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 11L11 3M11 3H4M11 3V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </Link>
        <a
          href="https://github.com/riyannode/ArcLayer"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-ghost"
        >
          GITHUB
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 11L11 3M11 3H4M11 3V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </a>
      </div>

      <HomeProofStrip />
      <HomeStats />
    </div>
  );
}
