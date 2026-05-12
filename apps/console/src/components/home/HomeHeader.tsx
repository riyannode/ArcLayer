'use client';

import Link from 'next/link';
import ArcMark from '@/components/ArcMark';

/**
 * Home header — top bar with ArcMark logo + ArcLayer wordmark, protocol nav,
 * live status indicator, and OPEN CONSOLE CTA. Kept separate from shared
 * Navbar so landing stays independent from in-app chrome.
 */
const nav = [
  { label: 'PROTOCOL', href: '#protocol' },
  { label: 'CONSOLE', href: '/dashboard' },
  { label: 'SDK', href: '/docs' },
  { label: 'AGENTS', href: '/agents' },
  { label: 'JOBS', href: '/jobs' },
];

export default function HomeHeader() {
  return (
    <header
      className="relative z-30 flex items-center justify-between border-b border-white/8 px-6 py-5 backdrop-blur-xl md:px-10"
      style={{ background: 'rgba(5, 5, 5, 0.6)' }}
    >
      <Link href="/" className="group flex items-center gap-3.5" aria-label="ArcLayer home">
        <div className="transition-transform duration-500 group-hover:scale-110">
          <ArcMark size={40} className="anim-breathe" />
        </div>
        <div className="flex flex-col leading-none">
          <span
            className="aureo-body text-[#EAE4D8]"
            style={{ fontSize: '21px', letterSpacing: '0.22em', fontWeight: 500 }}
          >
            ARCLAYER
          </span>
          <span className="mt-1.5 font-mono text-[11px] tracking-[0.2em] text-[#C5A67C]">
            PROTOCOL · AGENTIC ECONOMY
          </span>
        </div>
      </Link>

      <nav className="hidden items-center gap-9 md:flex">
        {nav.map((n) => (
          <Link
            key={n.label}
            href={n.href}
            className="font-mono text-[12.5px] tracking-[0.22em] text-[#B8B2A6] transition-colors duration-300 hover:text-[#C5A67C]"
            style={{ fontWeight: 500 }}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-2 sm:flex">
          <span className="pulse-dot" />
          <span className="font-mono text-[11.5px] tracking-[0.2em] text-[#B8CD7E]" style={{ fontWeight: 500 }}>
            LIVE · ARC
          </span>
        </div>
        <Link
          href="/dashboard"
          className="btn-primary"
          style={{ padding: '12px 20px', fontSize: '12px', fontWeight: 600 }}
        >
          OPEN CONSOLE
        </Link>
      </div>
    </header>
  );
}
