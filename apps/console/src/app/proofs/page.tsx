'use client';

import Link from 'next/link';

/**
 * /proofs — Live proof / validation history placeholder.
 * Redirects to protocol page until a dedicated proof matrix is built.
 */
export default function ProofsPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#050505] px-6 text-center">
      <span className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">
        Live History
      </span>
      <h1
        className="aureo-display mb-4 text-[#EAE4D8]"
        style={{ fontSize: 'clamp(24px, 3vw, 42px)', lineHeight: 1 }}
      >
        Proof Explorer
      </h1>
      <p className="mb-8 max-w-md font-mono text-[12px] leading-relaxed text-[rgba(234,228,216,0.6)]">
        On-chain job receipts, validation events, and tx history.
        Full proof matrix coming soon — for now, view live indexer data on the protocol page.
      </p>
      <div className="flex gap-3">
        <Link
          href="/dashboard"
          className="border border-white/10 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[#C5A67C] transition hover:border-[#C5A67C]/40 hover:bg-[rgba(197,166,124,0.06)]"
        >
          Open Dashboard →
        </Link>
        <Link
          href="/"
          className="border border-white/10 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.6)] transition hover:border-white/20 hover:text-[#EAE4D8]"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
