'use client';

import Link from 'next/link';
import HomeProofStrip from './HomeProofStrip';
import HomeStats from './HomeStats';

/**
 * Home hero — editorial serif headline, developer quickstart block,
 * CTAs, real deployed contracts strip, and live indexer stats.
 * Left column of the landing grid.
 */
export default function HomeHero() {
  return (
    <div className="relative flex flex-col justify-center">
      {/* Kicker */}
      <div className="mb-10 flex flex-col gap-1">
        <span className="aureo-mono-label">AGENTIC</span>
        <span className="aureo-mono-label">PROTOCOL</span>
      </div>

      {/* Headline — slogan */}
      <h1
        className="aureo-display text-[48px] text-[#EAE4D8] sm:text-[64px] md:text-[76px] lg:text-[84px]"
        style={{ lineHeight: 0.92 }}
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
      <div className="my-9 flex max-w-[540px] items-center gap-3">
        <span className="h-px flex-1 bg-white/15" />
        <span
          className="h-[10px] w-[10px] rotate-45 border border-[#C5A67C]/60"
          style={{ background: 'rgba(197, 166, 124, 0.14)' }}
        />
        <span className="h-px flex-1 bg-white/15" />
      </div>

      {/* Body */}
      <p className="aureo-body max-w-[540px] text-[15px] text-[#9a9a9a] md:text-[16.5px]">
        ArcLayer is a{' '}
        <span className="text-[#C5A67C]">settlement fabric for autonomous protocols</span>.
        Contract modules, a typed SDK, event indexing, and a console for inspecting jobs,
        escrow, and agent reputation — deployed on Arc (chain{' '}
        <span className="font-mono text-[#C5A67C]">5042002</span>).
      </p>

      {/* Developer quickstart */}
      <div className="mt-7 max-w-[540px]">
        <div className="aureo-mono-label mb-2">QUICKSTART</div>
        <pre className="code-block">
<span className="tok-c"># install workspace SDK</span>{'\n'}
<span className="tok-k">pnpm</span> add @arclayer/sdk{'\n'}{'\n'}
<span className="tok-c">// read contract + query job</span>{'\n'}
<span className="tok-k">import</span> {'{ CONTRACTS, readJob }'} <span className="tok-k">from</span>{' '}
<span className="tok-s">&apos;@arclayer/sdk&apos;</span>;{'\n'}
<span className="tok-k">const</span> job = <span className="tok-k">await</span> readJob(<span className="tok-s">0n</span>);
        </pre>
      </div>

      {/* CTAs */}
      <div className="mt-9 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
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
