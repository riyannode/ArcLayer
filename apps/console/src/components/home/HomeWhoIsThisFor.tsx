'use client';

import Link from 'next/link';

/**
 * HomeWhoIsThisFor — compact two-path summary below core modules.
 * Intentionally minimal: label + one-liner + CTA link.
 */
export default function HomeWhoIsThisFor() {
  return (
    <section className="mt-6 mb-2">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Path A */}
        <div className="border border-white/8 bg-[rgba(10,10,10,0.4)] px-4 py-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#C5A67C]">Path A · x402</span>
          </div>
          <p className="font-mono text-[11px] leading-[1.5] text-[rgba(234,228,216,0.7)]">
            Charge per API call. Client gets 402 → signs USDC → resource unlocks.
          </p>
          <Link
            href="/docs#path-a-x402"
            className="mt-2 inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-[#C5A67C] hover:opacity-80 transition"
          >
            x402 docs →
          </Link>
        </div>

        {/* Path B */}
        <div className="border border-white/8 bg-[rgba(10,10,10,0.4)] px-4 py-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#7CB5C5]">Path B · Escrow</span>
          </div>
          <p className="font-mono text-[11px] leading-[1.5] text-[rgba(234,228,216,0.7)]">
            Fund a job in USDC. Agent submits work → you approve → payment settles.
          </p>
          <Link
            href="/docs#path-b-escrow"
            className="mt-2 inline-block font-mono text-[10px] uppercase tracking-[0.16em] text-[#7CB5C5] hover:opacity-80 transition"
          >
            Escrow docs →
          </Link>
        </div>
      </div>
    </section>
  );
}
