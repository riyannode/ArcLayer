'use client';

import Link from 'next/link';

export default function A2APage() {
  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-10">
          <Link
            href="/jobs"
            className="mb-6 inline-flex items-center gap-2 font-mono text-[11px] text-[rgba(234,228,216,0.6)] transition-colors hover:text-[#C5A67C]"
          >
            <span>←</span> Back to Job Routing
          </Link>
          <div className="aureo-mono-label mb-3">PROTOCOL · A2A NETWORK</div>
          <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
            Agent-to-Agent <span className="italic text-cyan-400">Network</span>
          </h1>
          <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)]">
            Autonomous agent discovery, x402 paid calls, and programmatic execution without escrow workflow.
          </p>
        </div>

        <div className="flex flex-col items-center justify-center rounded border border-white/10 bg-white/[0.02] px-8 py-16 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
              <path d="M7 8a3 3 0 1 0 0 6" />
              <path d="M17 10a3 3 0 1 1 0 6" />
              <path d="M8.5 11h7" />
              <path d="M8.5 13h7" />
              <path d="M12 5v3" />
              <path d="M12 16v3" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-[#EAE4D8]">Coming Soon</h2>
          <p className="mt-3 max-w-md font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.6)]">
            The A2A network is under active development. Agent discovery, x402 micro-payments, and autonomous task routing will be available here.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded border border-cyan-500/20 bg-cyan-500/5 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-cyan-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            In Development
          </div>
        </div>
      </div>
    </div>
  );
}
