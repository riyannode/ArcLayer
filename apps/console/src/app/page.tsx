'use client';

import Link from 'next/link';
import DotMatrixField from '@/components/DotMatrixField';
import ArcMark from '@/components/ArcMark';

const sidebarNav = [
  { label: 'PROTOCOL', href: '#protocol' },
  { label: 'CONSOLE', href: '/dashboard' },
  { label: 'SDK', href: '/docs' },
  { label: 'AGENTS', href: '/agents' },
  { label: 'JOBS', href: '/jobs' },
  { label: 'DOCS', href: '/docs' },
];

const stats = [
  { label: 'MODULES', value: '04', suffix: 'contracts in active migration' },
  { label: 'AGENTS', value: '128+', suffix: 'on-chain identities indexed' },
  { label: 'AWARDS', value: '27', suffix: 'reputation milestones verified' },
];

export default function Home() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#050505] text-[#EAE4D8]">
      <DotMatrixField />

      {/* ─── Left vertical sidebar ─── */}
      <aside className="fixed left-0 top-0 z-30 hidden h-screen w-[72px] flex-col items-center justify-between border-r border-white/10 bg-black/30 py-8 backdrop-blur-xl md:flex">
        {/* Brand vertical */}
        <Link href="/" className="flex flex-col items-center gap-4" aria-label="ArcLayer home">
          <span
            className="aureo-sidebar-label text-[#EAE4D8]"
            style={{ fontSize: '11px', letterSpacing: '0.42em' }}
          >
            ARCLAYER
          </span>
          <ArcMark size={22} />
        </Link>

        {/* Vertical nav */}
        <nav className="flex flex-col items-center gap-8">
          {sidebarNav.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="aureo-sidebar-label text-[#7A7A7A] transition-colors duration-300 hover:text-[#C5A67C]"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        {/* Status dot */}
        <div className="flex flex-col items-center gap-2">
          <div className="relative flex h-3 w-3 items-center justify-center">
            <span className="absolute h-3 w-3 rounded-full bg-[#C5A67C] opacity-30 blur-[3px]" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-[#C5A67C]" />
          </div>
          <span
            className="aureo-sidebar-label text-[#7A7A7A]"
            style={{ fontSize: '9px', letterSpacing: '0.32em' }}
          >
            LIVE · ARC
          </span>
        </div>
      </aside>

      {/* ─── Main content ─── */}
      <main className="relative z-20 min-h-screen md:pl-[72px]">
        {/* Top bar for mobile */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 md:hidden">
          <Link href="/" className="flex items-center gap-2">
            <ArcMark size={22} />
            <span className="aureo-body text-xs tracking-[0.32em] text-[#EAE4D8]">
              ARCLAYER
            </span>
          </Link>
          <Link
            href="/dashboard"
            className="aureo-mono-label text-[#C5A67C] transition-colors hover:text-[#EAE4D8]"
          >
            CONSOLE →
          </Link>
        </div>

        <div className="relative mx-auto grid max-w-[1600px] grid-cols-1 gap-8 px-6 py-10 md:grid-cols-[1.02fr_0.98fr] md:gap-12 md:px-10 md:py-14 lg:px-16">
          {/* ─── Hero column ─── */}
          <div className="relative flex flex-col justify-center">
            {/* AI / CREATIVITY kicker */}
            <div className="mb-10 flex flex-col gap-1">
              <span className="aureo-mono-label">AGENTIC</span>
              <span className="aureo-mono-label">PROTOCOL</span>
            </div>

            {/* Headline */}
            <h1 className="aureo-display text-[64px] text-[#EAE4D8] sm:text-[80px] md:text-[104px] lg:text-[120px]">
              <span className="block">PROTOCOL</span>
              <span className="block">LAYER FOR THE</span>
              <span className="block italic text-[#C5A67C]">agentic economy</span>
            </h1>

            {/* Divider mark */}
            <div className="my-8 flex max-w-[520px] items-center gap-3">
              <span className="h-px flex-1 bg-white/15" />
              <span
                className="h-[10px] w-[10px] rotate-45 border border-[#C5A67C]/60"
                style={{ background: 'rgba(197, 166, 124, 0.14)' }}
              />
              <span className="h-px flex-1 bg-white/15" />
            </div>

            {/* Body */}
            <p className="aureo-body max-w-[480px] text-[15px] text-[#9a9a9a] md:text-[16px]">
              ArcLayer is a settlement fabric for autonomous labor. Contract modules, SDK
              access, event indexing, and a console for inspecting jobs, escrow, and
              agent reputation — deployed on Arc.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
              <Link href="/dashboard" className="btn-primary">
                OPEN CONSOLE
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M3 11L11 3M11 3H4M11 3V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </Link>
              <Link href="/docs" className="btn-ghost">
                EXPLORE SDK
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M3 11L11 3M11 3H4M11 3V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </Link>
            </div>

            {/* Stats row */}
            <div className="mt-16 grid max-w-[520px] grid-cols-3 gap-6">
              {stats.map((s) => (
                <div key={s.label} className="flex flex-col">
                  <span className="aureo-mono-label mb-3">{s.label}</span>
                  <span className="aureo-display text-[44px] text-[#EAE4D8] md:text-[52px]">
                    {s.value}
                  </span>
                  <span className="mt-2 h-px w-8 bg-[#C5A67C]/40" />
                  <span className="mt-2 text-[10px] leading-4 text-[#7A7A7A]">
                    {s.suffix}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ─── Right column: architectural arch ─── */}
          <div className="relative flex min-h-[500px] items-center justify-center md:min-h-[720px]">
            <ArchVisual />

            {/* Featured project card, overlapping bottom */}
            <FeaturedCard />
          </div>
        </div>

        {/* ─── Bottom strip: chain metadata ─── */}
        <div className="relative z-20 mx-auto max-w-[1600px] border-t border-white/10 px-6 py-6 md:px-10 md:pl-[72px] lg:px-16">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              ['NETWORK', 'Arc Testnet'],
              ['CHAIN ID', '5042002'],
              ['SETTLEMENT', 'Testnet USDC'],
              ['INDEXER', 'Live · 2 blk/s'],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1.5">
                <span className="aureo-mono-label">{k}</span>
                <span className="aureo-body text-[13px] text-[#EAE4D8]">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ─── Architectural arch visual (approximates the AUREO megastructure) ─── */
function ArchVisual() {
  return (
    <div className="relative h-full w-full max-w-[680px]">
      {/* Huge semi-circular arch frame */}
      <svg
        viewBox="0 0 600 720"
        className="absolute inset-0 h-full w-full"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="archRim" x1="0" y1="0" x2="0" y2="720" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#EAE4D8" stopOpacity="0.7" />
            <stop offset="0.4" stopColor="#C5A67C" stopOpacity="0.85" />
            <stop offset="0.85" stopColor="#C5A67C" stopOpacity="0.25" />
            <stop offset="1" stopColor="#050505" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="archInner" x1="0" y1="0" x2="0" y2="720" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#C5A67C" stopOpacity="0.35" />
            <stop offset="0.6" stopColor="#C5A67C" stopOpacity="0.1" />
            <stop offset="1" stopColor="#050505" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="archVoid" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#050505" stopOpacity="0.95" />
            <stop offset="0.7" stopColor="#050505" stopOpacity="0.6" />
            <stop offset="1" stopColor="#C5A67C" stopOpacity="0" />
          </radialGradient>
          <filter id="archGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer arch rings — triple band for depth */}
        <ellipse cx="300" cy="280" rx="295" ry="270" stroke="url(#archRim)" strokeWidth="2.5" filter="url(#archGlow)" />
        <ellipse cx="300" cy="280" rx="278" ry="255" stroke="rgba(197, 166, 124, 0.35)" strokeWidth="0.8" />
        <ellipse cx="300" cy="280" rx="262" ry="240" stroke="rgba(197, 166, 124, 0.22)" strokeWidth="0.6" />

        {/* Concentric inner arcs (structural detail) */}
        {[235, 210, 185, 160, 135, 110, 90].map((r, i) => (
          <ellipse
            key={r}
            cx="300"
            cy="280"
            rx={r + 18}
            ry={r}
            stroke={`rgba(197, 166, 124, ${0.35 - i * 0.04})`}
            strokeWidth="0.5"
          />
        ))}

        {/* Dense radial struts (36 rays) */}
        {Array.from({ length: 36 }).map((_, i) => {
          const angle = (Math.PI / 36) * i;
          const x1 = 300 + Math.cos(Math.PI + angle) * 295;
          const y1 = 280 + Math.sin(Math.PI + angle) * 270;
          const x2 = 300 + Math.cos(Math.PI + angle) * 90;
          const y2 = 280 + Math.sin(Math.PI + angle) * 85;
          const major = i % 6 === 0;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={major ? 'rgba(234, 228, 216, 0.3)' : 'rgba(197, 166, 124, 0.1)'}
              strokeWidth={major ? 0.7 : 0.35}
            />
          );
        })}

        {/* Rim waypoint nodes on outer ring */}
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (Math.PI / 12) * i;
          const x = 300 + Math.cos(Math.PI + angle) * 295;
          const y = 280 + Math.sin(Math.PI + angle) * 270;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="3" fill="rgba(234, 228, 216, 0.8)" />
              <circle cx={x} cy={y} r="6" fill="rgba(197, 166, 124, 0.2)" />
            </g>
          );
        })}

        {/* Orbital ellipse (angled perspective) */}
        <ellipse
          cx="300"
          cy="280"
          rx="200"
          ry="42"
          stroke="rgba(197, 166, 124, 0.35)"
          strokeWidth="0.8"
          strokeDasharray="2 3"
        />
        <ellipse
          cx="300"
          cy="280"
          rx="160"
          ry="28"
          stroke="rgba(184, 205, 126, 0.3)"
          strokeWidth="0.6"
        />

        {/* Inner void — the eye of the ring */}
        <ellipse cx="300" cy="280" rx="72" ry="65" fill="url(#archVoid)" />
        <ellipse cx="300" cy="280" rx="72" ry="65" stroke="rgba(234, 228, 216, 0.4)" strokeWidth="0.6" />
        <ellipse cx="300" cy="280" rx="48" ry="42" fill="url(#archInner)" />

        {/* Central core */}
        <g filter="url(#archGlow)">
          <circle cx="300" cy="280" r="3" fill="#EAE4D8" />
          <circle cx="300" cy="280" r="8" fill="rgba(234, 228, 216, 0.25)" />
          <circle cx="300" cy="280" r="14" fill="rgba(197, 166, 124, 0.12)" />
        </g>

        {/* Horizon line */}
        <line x1="0" y1="560" x2="600" y2="560" stroke="rgba(197, 166, 124, 0.4)" strokeWidth="0.8" />
        <line x1="0" y1="562" x2="600" y2="562" stroke="rgba(197, 166, 124, 0.15)" strokeWidth="0.4" />

        {/* Base city silhouette — layered skyline */}
        <g opacity="0.85">
          {/* Background layer — distant spires */}
          {Array.from({ length: 16 }).map((_, i) => {
            const x = 40 + i * 35;
            const h = 40 + Math.sin(i * 1.7) * 28 + (i % 3 === 0 ? 50 : 15);
            return (
              <rect
                key={`bg-${i}`}
                x={x}
                y={560 - h}
                width="4"
                height={h}
                fill="rgba(197, 166, 124, 0.15)"
              />
            );
          })}
          {/* Foreground layer — tower blocks */}
          {Array.from({ length: 28 }).map((_, i) => {
            const x = 20 + i * 21;
            const h = 22 + Math.sin(i * 0.9) * 18 + (i % 5 === 0 ? 55 : 0) + (i === 14 ? 45 : 0);
            return (
              <g key={`fg-${i}`}>
                <rect
                  x={x}
                  y={560 - h}
                  width="9"
                  height={h}
                  fill="rgba(20, 18, 14, 0.9)"
                  stroke="rgba(197, 166, 124, 0.4)"
                  strokeWidth="0.5"
                />
                {/* window dots */}
                {h > 50 && (
                  <>
                    <rect x={x + 2} y={560 - h + 8} width="1" height="1" fill="rgba(234, 228, 216, 0.8)" />
                    <rect x={x + 5} y={560 - h + 14} width="1" height="1" fill="rgba(197, 166, 124, 0.7)" />
                    <rect x={x + 2} y={560 - h + 22} width="1" height="1" fill="rgba(234, 228, 216, 0.6)" />
                  </>
                )}
              </g>
            );
          })}
          {/* Central spire rising into ring */}
          <rect x="296" y="420" width="8" height="140" fill="rgba(30, 26, 20, 0.95)" stroke="rgba(234, 228, 216, 0.5)" strokeWidth="0.6" />
          <rect x="294" y="420" width="12" height="6" fill="rgba(197, 166, 124, 0.6)" />
          <rect x="299" y="380" width="2" height="40" fill="rgba(234, 228, 216, 0.8)" />
          <circle cx="300" cy="378" r="2" fill="#EAE4D8" filter="url(#archGlow)" />
        </g>

        {/* Ground plane fade */}
        <rect x="0" y="560" width="600" height="160" fill="url(#archInner)" opacity="0.3" />
      </svg>

      {/* Floating coordinate tags */}
      <div className="absolute left-[8%] top-[22%] aureo-glass px-3 py-2">
        <div className="aureo-mono-label" style={{ fontSize: '9px' }}>
          ESCROW · ACTIVE
        </div>
        <div className="mt-1 font-mono text-[11px] text-[#C5A67C]">1,250 USDC</div>
      </div>
      <div className="absolute right-[6%] top-[36%] aureo-glass px-3 py-2">
        <div className="aureo-mono-label" style={{ fontSize: '9px' }}>
          PROOF · PENDING
        </div>
        <div className="mt-1 font-mono text-[11px] text-[#B8CD7E]">Milestone 03</div>
      </div>
      <div className="absolute left-[22%] bottom-[28%] aureo-glass px-3 py-2">
        <div className="aureo-mono-label" style={{ fontSize: '9px' }}>
          AGENT · 0xA4
        </div>
        <div className="mt-1 font-mono text-[11px] text-[#EAE4D8]">Reputation 8.6</div>
      </div>
    </div>
  );
}

/* ─── AEON RITUAL-style featured card ─── */
function FeaturedCard() {
  return (
    <div className="absolute bottom-[-8%] right-[-2%] z-10 w-[320px] aureo-glass aureo-card-glow p-5 md:w-[360px]">
      {/* Card header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="pulse-dot" />
          <span className="aureo-mono-label">ACTIVE</span>
        </div>
        <Link href="/jobs" className="aureo-mono-label text-[#C5A67C] hover:text-[#EAE4D8]">
          VIEW ALL →
        </Link>
      </div>

      {/* Title + thumbnail */}
      <div className="flex gap-3">
        <div className="aureo-stroke relative flex h-14 w-14 flex-shrink-0 items-center justify-center bg-black/40">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <path
              d="M14 3 L24 23 H4 Z"
              stroke="#C5A67C"
              strokeWidth="1"
              fill="rgba(197, 166, 124, 0.12)"
            />
            <circle cx="14" cy="17" r="2" fill="#C5A67C" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="aureo-display text-[22px] leading-none text-[#EAE4D8]">
            AEON ESCROW
          </h3>
          <p className="mt-1.5 text-[10px] leading-4 text-[#7A7A7A]">
            Agent labor settled against milestone proofs. Release on approval.
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-5 flex items-center justify-between">
        <span className="aureo-mono-label">PROGRESS</span>
        <span className="aureo-body text-[11px] text-[#EAE4D8]">78%</span>
      </div>
      <div className="relative mt-2 h-px w-full bg-white/10">
        <div
          className="absolute left-0 top-0 h-px bg-[#C5A67C]"
          style={{ width: '78%', boxShadow: '0 0 6px rgba(197, 166, 124, 0.8)' }}
        />
        <div
          className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#EAE4D8]"
          style={{ left: '78%', boxShadow: '0 0 8px rgba(234, 228, 216, 0.9)' }}
        />
      </div>
    </div>
  );
}
