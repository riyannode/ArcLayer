'use client';

/**
 * HomeX402ProofCard — lightweight x402 proof section for the landing page.
 *
 * Shows reviewers immediately that ArcLayer has live x402 protected resources
 * without making the landing page noisy. No wallet required to view.
 */

import Link from 'next/link';

const EXPLORER = 'https://testnet.arcscan.app';

const STATUS_BADGES = [
  { label: 'Arc Native Payment', status: 'live', color: 'text-emerald-400' },
  { label: 'Circle Gateway Payment', status: 'ready', color: 'text-amber-300' },
  { label: 'PAYMENT-RESPONSE', status: 'supported', color: 'text-emerald-400' },
  { label: 'Replay Protection', status: 'verified', color: 'text-emerald-400' },
] as const;

const FLOW_STEPS = [
  '402 challenge',
  'sign payment',
  'verify',
  'settle',
  'unlock resource',
  'duplicate receipt rejected',
] as const;

export default function HomeX402ProofCard() {
  return (
    <section className="mt-10 rounded-lg border border-[#C5A67C]/20 bg-[#0A0A0A]/80 p-5 backdrop-blur-sm md:mt-12">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-mono text-xs uppercase tracking-widest text-[#C5A67C]">
            Live x402 Protected Resource
          </h3>
          <p className="mt-1 text-[11px] text-[#a0a0a0] invisible">
            Unlock a protected agent/API resource with Arc Native or Circle Gateway payment.
          </p>
        </div>
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/20 px-2.5 py-0.5 font-mono text-[9px] uppercase text-emerald-400 sm:mt-0">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          on-chain
        </span>
      </div>

      {/* Status badges */}
      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_BADGES.map((b) => (
          <span
            key={b.label}
            className="inline-flex items-center gap-1.5 rounded border border-white/5 bg-white/[0.02] px-2 py-1 font-mono text-[9.5px]"
          >
            <span className="text-[#b5b5b5]">{b.label}:</span>
            <span className={b.color}>{b.status}</span>
          </span>
        ))}
      </div>

      {/* Flow visualization */}
      <div className="mt-4 overflow-x-auto rounded border border-white/5 bg-white/[0.01] px-3 py-2">
        <div className="flex items-center gap-1 font-mono text-[9px] text-[#a0a0a0] whitespace-nowrap">
          {FLOW_STEPS.map((step, i) => (
            <span key={step} className="flex items-center gap-1">
              <span className="text-[#b5b5b5]">{step}</span>
              {i < FLOW_STEPS.length - 1 && <span className="text-[#C5A67C]">→</span>}
            </span>
          ))}
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 text-[10.5px] leading-relaxed text-[#a0a0a0]">
        ArcLayer includes a live x402 protected resource. Choose Arc Native or Circle Gateway
        to unlock a protected agent/API resource, then see duplicate receipt protection reject
        reused payments. Each settlement is 0.000001 USDC on Arc Testnet — verifiable on-chain.
      </p>

      {/* CTAs */}
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-3 py-1.5 font-mono text-[10px] text-[#C5A67C] transition-colors hover:bg-[#C5A67C]/20"
        >
          Open payment ticket →
        </Link>
        <a
          href={`${EXPLORER}/address/0x4aA3402575b6D98EacE35A823EFa267F7365bdD2`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/[0.02] px-3 py-1.5 font-mono text-[10px] text-[#b5b5b5] transition-colors hover:text-[#EAE4D8]"
        >
          View on explorer ↗
        </a>
        <Link
          href="/docs"
          className="inline-flex items-center gap-1.5 rounded border border-white/10 bg-white/[0.02] px-3 py-1.5 font-mono text-[10px] text-[#b5b5b5] transition-colors hover:text-[#EAE4D8]"
        >
          Integration docs →
        </Link>
      </div>
    </section>
  );
}
