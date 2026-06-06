'use client';

import Link from 'next/link';
import { HOME_PATHS } from '@/data/home-paths';

/**
 * HomeOnboardingCards — 2×2 "Choose Your Path" grid.
 *
 * Lives inside the left hero column, below the x402 demo panel.
 * Text sized for clear visibility at landing viewport.
 */
export default function HomeOnboardingCards() {
  return (
    <div className="mt-5 section-reveal" style={{ animationDelay: '0.55s' }}>
      <span className="aureo-mono-label mb-3 block text-[#C5A67C]">
        CHOOSE YOUR PATH
      </span>

      <div className="grid grid-cols-2 gap-3">
        {HOME_PATHS.map((path) => (
          <Link
            key={path.tag}
            href={path.href}
            className="group relative flex flex-col border border-white/[0.08] bg-[rgba(10,10,10,0.5)] px-4 py-4 transition-all duration-300 hover:border-white/[0.16] hover:bg-[rgba(15,15,15,0.7)]"
          >
            {/* Top accent line on hover */}
            <span
              className="absolute left-0 top-0 h-[2px] w-0 transition-all duration-500 group-hover:w-full"
              style={{ background: path.accent }}
            />

            {/* Protocol tag */}
            <span
              className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.16em]"
              style={{ color: path.accent }}
            >
              {path.tag}
            </span>

            {/* Title */}
            <span className="mb-3 font-mono text-[14px] font-semibold leading-snug text-[#F5F0E5]">
              {path.title}
            </span>

            {/* CTA arrow */}
            <span
              className="mt-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-all duration-300 group-hover:gap-2.5"
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
