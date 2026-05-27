'use client';

import Link from 'next/link';
import { HOME_PATHS } from '@/data/home-paths';

/**
 * HomeProtocolSection — "Choose Your Path" onboarding cards.
 *
 * Sits below the hero/indexer area on the landing page.
 * Four entry-point cards guide visitors to the right starting point:
 *   x402 · ERC-8004 · ERC-8183 · Proofs
 */
export default function HomeProtocolSection() {
  return (
    <section
      id="protocol"
      className="relative z-20 px-6 py-14 md:px-12 md:pl-[80px] md:py-16 lg:px-24"
    >
      {/* Divider line */}
      <div
        className="pointer-events-none absolute left-[56px] top-0 h-px w-[48%] bg-white/[0.06] md:w-[50%] xl:w-[52%] 2xl:w-[56%]"
        aria-hidden="true"
      />

      <div className="mx-auto max-w-[1600px]">
        {/* Section header */}
        <div className="mb-8">
          <span className="aureo-mono-label text-[#C5A67C]">
            GETTING STARTED
          </span>
          <h2
            className="aureo-display mt-2 text-[#EAE4D8]"
            style={{ fontSize: 'clamp(20px, 2vw, 32px)', lineHeight: 1.1 }}
          >
            Choose your path
          </h2>
        </div>

        {/* Four onboarding cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOME_PATHS.map((path) => (
            <Link
              key={path.tag}
              href={path.href}
              className="group relative flex flex-col border border-white/[0.08] bg-[rgba(10,10,10,0.5)] px-5 py-5 transition-all duration-300 hover:border-white/[0.16] hover:bg-[rgba(15,15,15,0.7)]"
            >
              {/* Top accent line */}
              <span
                className="absolute left-0 top-0 h-[2px] w-0 transition-all duration-500 group-hover:w-full"
                style={{ background: path.accent }}
              />

              {/* Icon */}
              <span className="mb-3 text-[20px]">{path.icon}</span>

              {/* Protocol tag */}
              <span
                className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em]"
                style={{ color: path.accent }}
              >
                {path.tag}
              </span>

              {/* Title */}
              <h3 className="mb-2 font-mono text-[13px] font-medium leading-snug text-[#EAE4D8]">
                {path.title}
              </h3>

              {/* Description */}
              <p className="mb-4 flex-1 font-mono text-[11px] leading-[1.6] text-[rgba(234,228,216,0.6)]">
                {path.description}
              </p>

              {/* CTA */}
              <span
                className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-all duration-300 group-hover:gap-2.5"
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
    </section>
  );
}
