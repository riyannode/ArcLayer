'use client';

import Link from 'next/link';
import ArcMark from '@/components/ArcMark';

/**
 * Home featured card — compact side panel that sits next to the live log stream.
 * Represents a live escrowed job settlement.
 */
export default function HomeFeaturedCard() {
  return (
    <div className="aureo-glass aureo-card-glow flex h-full flex-col justify-between p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="pulse-dot" />
          <span className="aureo-mono-label" style={{ fontSize: '10px' }}>ACTIVE</span>
        </div>
        <Link
          href="/jobs"
          className="aureo-mono-label text-[#C5A67C] hover:text-[#EAE4D8]"
          style={{ fontSize: '10px' }}
        >
          VIEW ALL →
        </Link>
      </div>

      <div className="flex gap-3">
        <div className="aureo-stroke relative flex h-12 w-12 flex-shrink-0 items-center justify-center bg-black/40">
          <ArcMark size={26} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="aureo-display text-[18px] leading-none text-[#EAE4D8]">
            AEON ESCROW
          </h3>
          <p className="mt-1.5 font-mono text-[10px] leading-4 text-[#a0a0a0]">
            Job settled against milestone proofs.
          </p>
        </div>
      </div>

      <div>
        <div className="mt-4 flex items-center justify-between">
          <span className="aureo-mono-label" style={{ fontSize: '10px' }}>PROGRESS</span>
          <span className="font-mono text-[11px] text-[#EAE4D8]">78%</span>
        </div>
        <div className="relative mt-2 h-px w-full bg-white/10">
          <div
            className="absolute left-0 top-0 h-px bg-[#C5A67C]"
            style={{ width: '78%', boxShadow: '0 0 6px rgba(197, 166, 124, 0.9)' }}
          />
          <div
            className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#EAE4D8]"
            style={{ left: '78%', boxShadow: '0 0 10px rgba(234, 228, 216, 0.95)' }}
          />
        </div>
      </div>
    </div>
  );
}
