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
      <Link href="/" className="group flex items-center gap-3" aria-label="ArcLayer home">
        <ArcMark size={34} className="transition-transform duration-500 group-hover:rotate-3" />
        <div className="flex flex-col leading-none">
          <span
            className="aureo-body text-[#EAE4D8] transition-colors duration-300 group-hover:text-[#C5A67C]"
            style={{ fontSize: '24px', letterSpacing: '0.22em', fontWeight: 500 }}
          >
            ARCLAYER
          </span>
          <span className="mt-1.5 font-mono text-[11.5px] tracking-[0.2em] text-[#C5A67C]">
            PROTOCOL · AGENTIC ECONOMY
          </span>
        </div>
      </Link>

      <nav className="hidden items-center gap-9 md:flex">
        {nav.map((n) => (
          <Link
            key={n.label}
            href={n.href}
            className="font-mono text-[14px] tracking-[0.22em] text-[#B8B2A6] transition-colors duration-300 hover:text-[#C5A67C]"
            style={{ fontWeight: 600 }}
          >
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-2 sm:flex">
          <span className="pulse-dot" />
          <span className="font-mono text-[12px] tracking-[0.2em] text-[#B8CD7E]" style={{ fontWeight: 500 }}>
            LIVE · ARC
          </span>
        </div>
        <Link
          href="/dashboard"
          className="btn-primary"
          style={{ padding: '12px 22px', fontSize: '12.5px', fontWeight: 600 }}
        >
          OPEN CONSOLE
        </Link>
      </div>
    </header>
  );
}
