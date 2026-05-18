'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useState, useEffect, MouseEvent } from 'react';
import ArcMark from './ArcMark';

/**
 * Unified top navigation — single source of truth for both landing (`/`) and
 * app pages (`/dashboard`, `/agents`, `/jobs`, `/docs`).
 *
 * Depth comes from behavior, not styling forks:
 *   - 4 nav items, same order, everywhere.
 *   - PROTOCOL is a smart anchor: in-page smooth scroll on `/`, route+hash
 *     jump on any other page.
 *   - WalletStatus is always present; it renders the context-correct CTA
 *     (CONNECT → OPEN CONSOLE on landing when authenticated → address pill
 *     in-app) internally via the `variant` prop.
 *   - LIVE · ARC indicator is landing-only flavor, not a separate navbar.
 */

// Privy SDK only initializes client-side. Dynamic-import w/ ssr:false avoids
// hydration mismatch (React #425/#418/#423) that crashes the whole Navbar tree.
const WalletStatus = dynamic(() => import('./WalletStatus'), {
  ssr: false,
  loading: () => (
    <div
      className="px-3 py-2 font-mono text-[10px] tracking-[0.18em] text-white/80"
      style={{ border: '1px solid rgba(255, 255, 255, 0.08)' }}
    >
      LOADING…
    </div>
  ),
});

// NotifBell uses Privy hooks + localStorage; client-only to avoid SSR mismatch.
const NotifBell = dynamic(() => import('./NotifBell'), {
  ssr: false,
  loading: () => null,
});

const NAV_LINKS = [
  { href: '/protocol', label: 'PROTOCOL', anchor: null },
  { href: '/live-a2a-agent', label: 'LIVE A2A AGENT', anchor: null },
  { href: '/register', label: 'AGENT', anchor: null },
  { href: '/jobs', label: 'JOBS', anchor: null },
  { href: '/docs', label: 'SDK', anchor: null },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Smart anchor: if we're already on the page that owns the anchor, prevent
  // the full navigation and smooth-scroll instead. Otherwise let <Link> do its
  // normal route + hash handling (browser auto-scrolls to #id on load).
  const handleAnchorClick = (anchorId: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== '/') return;
    e.preventDefault();
    document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMenuOpen(false);
  };

  const isLinkActive = (href: string, anchor: string | null) => {
    if (anchor) return false; // anchor links never show active underline
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <nav
      className="sticky top-0 z-50 border-b border-white/10 backdrop-blur-xl transition-all duration-500"
      style={{
        background: 'rgba(5, 5, 5, 0.85)',
        height: scrolled ? '60px' : '72px',
      }}
    >
      <div className="flex h-full w-full items-center justify-between transition-all duration-500">
        {/* Brand — pinned to viewport left (aligns with HomeSidebar column) */}
        <Link href="/" className="group flex items-center gap-3 pl-3 md:pl-4" aria-label="ArcLayer home">
          <div className="relative transition-transform duration-300 group-hover:scale-105">
            <ArcMark size={scrolled ? 30 : 34} glow={false} />
          </div>
          <div className="flex flex-col leading-none">
            <span
              className="aureo-body text-[#EAE4D8]"
              style={{ fontSize: '15px', letterSpacing: '0.24em', fontWeight: 400 }}
            >
              ARCLAYER
            </span>
            <span className="mt-1 hidden font-mono text-[9px] tracking-[0.2em] text-[#C5A67C] md:block">
              x402 · ESCROW · PROOF
            </span>
          </div>
        </Link>

        {/* Desktop Links */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = isLinkActive(link.href, link.anchor);
            return (
              <Link
                key={link.label}
                href={link.href}
                onClick={link.anchor ? handleAnchorClick(link.anchor) : undefined}
                className="relative px-4 py-2 transition-all duration-300"
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '11px',
                  letterSpacing: '0.24em',
                  fontWeight: 400,
                  color: isActive ? '#C5A67C' : '#EAE4D8',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = '#C5A67C'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = '#EAE4D8'; }}
              >
                {link.label}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-1/2 h-[1px] w-6 -translate-x-1/2"
                    style={{ background: '#C5A67C', boxShadow: '0 0 8px rgba(197, 166, 124, 0.8)' }}
                  />
                )}
              </Link>
            );
          })}
        </div>

        {/* TESTNET indicator + Wallet + Mobile hamburger — pinned to viewport right */}
        <div className="flex items-center gap-3 pr-3 md:pr-10">
          {isLanding && (
            <div className="hidden items-center gap-2 sm:flex">
              <span className="pulse-dot" />
              <span
                className="font-mono text-[11px] tracking-[0.2em] text-[#B8CD7E]"
                style={{ fontWeight: 500 }}
              >
                TESTNET
              </span>
            </div>
          )}

          {!isLanding && <NotifBell />}

          <WalletStatus variant={isLanding ? 'landing' : 'app'} />

          <button
            className="md:hidden flex flex-col gap-1.5 p-2"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen}
          >
            <span className="h-[1.5px] w-5 transition-all duration-300" style={{ background: '#C5A67C', transform: menuOpen ? 'rotate(45deg) translateY(4px)' : 'none' }} />
            <span className="h-[1.5px] w-5 transition-all duration-300" style={{ background: '#C5A67C', opacity: menuOpen ? 0 : 1 }} />
            <span className="h-[1.5px] w-5 transition-all duration-300" style={{ background: '#C5A67C', transform: menuOpen ? 'rotate(-45deg) translateY(-4px)' : 'none' }} />
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <div
        className="md:hidden overflow-hidden transition-all duration-400"
        style={{
          maxHeight: menuOpen ? '320px' : '0',
          opacity: menuOpen ? 1 : 0,
          borderTop: menuOpen ? '1px solid rgba(255,255,255,0.08)' : 'none',
          background: 'rgba(5, 5, 5, 0.96)',
        }}
      >
        <div className="px-6 py-5 space-y-1">
          {NAV_LINKS.map((link) => {
            const isActive = isLinkActive(link.href, link.anchor);
            return (
              <Link
                key={link.label}
                href={link.href}
                onClick={(e) => {
                  if (link.anchor) handleAnchorClick(link.anchor)(e);
                  setMenuOpen(false);
                }}
                className="block py-3 px-4 transition-all duration-200"
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '11px',
                  letterSpacing: '0.24em',
                  color: isActive ? '#C5A67C' : '#EAE4D8',
                  background: isActive ? 'rgba(197, 166, 124, 0.08)' : 'transparent',
                  borderLeft: isActive ? '2px solid #C5A67C' : '2px solid transparent',
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
