'use client';

import Link from 'next/link';
import { HOME_PATHS } from '@/data/home-paths';

/**
 * HomeOnboardingCards — compact 2×2 "Choose Your Path" grid.
 *
 * Lives inside the left hero column, below the x402 demo panel.
 * Each card is a minimal entry point: tag + title + arrow.
 */
export default function HomeOnboardingCards() {
  return (
    <div className="mt-4 section-reveal" style={{ animationDelay: '0.55s' }}>
      <span className="aureo-mono-label mb-3 block text-[#EAE4D8]/72">
        CHOOSE YOUR PATH
      </span>

      <div className="grid grid-cols-2 gap-2.5">
        {HOME_PATHS.map((path) => (
          <Link
            key={path.tag}
            href={path.href}
            className="group relative flex flex-col border border-white/[0.08] bg-[rgba(10,10,10,0.5)] px-3.5 py-3 transition-all duration-300 hover:border-white/[0.16] hover:bg-[rgba(15,15,15,0.7)]"
          >
            {/* Top accent line on hover */}
            <span
              className="absolute left-0 top-0 h-[2px] w-0 transition-all duration-500 group-hover:w-full"
              style={{ background: path.accent }}
            />

            {/* Protocol tag */}
            <span
              className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em]"
              style={{ color: path.accent }}
            >
              {path.tag}
            </span>

            {/* Title */}
            <span className="mb-2 font-mono text-[12px] font-medium leading-snug text-[#EAE4D8]">
              {path.title}
            </span>

            {/* CTA arrow */}
            <span
              className="mt-auto inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.16em] transition-all duration-300 group-hover:gap-2"
              style={{ color: path.accent }}
            >
              {path.cta}
              <span className="transition-transform duration-300 group-hover:translate-x-1">
                →
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
