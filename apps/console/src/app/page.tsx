'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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

type Stat = { label: string; value: string; suffix: string };
const fallbackStats: Stat[] = [
  { label: 'MODULES', value: '04', suffix: 'protocol contracts deployed' },
  { label: 'AGENTS', value: '02', suffix: 'registered on-chain' },
  { label: 'PROOFS', value: '02', suffix: 'settled jobs proven' },
];

// Real deployed contracts on Arc Testnet (chain 5042002)
const contracts = [
  { label: 'JOB ESCROW', addr: '0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225' },
  { label: 'AGENT REGISTRY', addr: '0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21' },
  { label: 'WORK PROOF', addr: '0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5' },
  { label: 'MILESTONE ESCROW', addr: '0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2' },
];
const ARC_EXPLORER = 'https://explorer.testnet.arc.network';

export default function Home() {
  const [stats, setStats] = useState<Stat[]>(fallbackStats);
  const [ready, setReady] = useState(false);

  // Try to hydrate with real indexer data; silently fall back on failure.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/indexer/overview', { cache: 'no-store' });
        if (!res.ok) throw new Error('indexer not ready');
        const data = await res.json();
        if (cancelled) return;
        const s = data?.summary;
        if (s) {
          setStats([
            { label: 'MODULES', value: '04', suffix: 'protocol contracts deployed' },
            { label: 'AGENTS', value: String(s.agents ?? 0).padStart(2, '0'), suffix: 'registered on-chain' },
            { label: 'PROOFS', value: String(s.settledJobs ?? 0).padStart(2, '0'), suffix: 'settled jobs proven' },
          ]);
        }
      } catch {
        /* keep fallback */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#050505] text-[#EAE4D8]">
      <DotMatrixField />

      {/* ─── Top header (contains logo as user requested) ─── */}
      <header className="relative z-30 flex items-center justify-between border-b border-white/8 px-6 py-5 backdrop-blur-xl md:px-10" style={{ background: 'rgba(5, 5, 5, 0.6)' }}>
        <Link href="/" className="group flex items-center gap-3" aria-label="ArcLayer home">
          <div className="transition-transform duration-500 group-hover:scale-110">
            <ArcMark size={36} className="anim-breathe" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="aureo-body text-[#EAE4D8]" style={{ fontSize: '17px', letterSpacing: '0.26em', fontWeight: 400 }}>
              ARCLAYER
            </span>
            <span className="mt-1 font-mono text-[9.5px] tracking-[0.22em] text-[#C5A67C]">
              PROTOCOL · AGENTIC ECONOMY
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {sidebarNav.slice(0, 5).map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="font-mono text-[10.5px] tracking-[0.24em] text-[#7A7A7A] transition-colors duration-300 hover:text-[#C5A67C]"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2 sm:flex">
            <span className="pulse-dot" />
            <span className="font-mono text-[10px] tracking-[0.2em] text-[#B8CD7E]">
              LIVE · ARC
            </span>
          </div>
          <Link href="/dashboard" className="btn-primary" style={{ padding: '11px 18px', fontSize: '11px' }}>
            OPEN CONSOLE
          </Link>
        </div>
      </header>

      {/* ─── Left vertical sidebar (slimmer, index only) ─── */}
      <aside className="fixed left-0 top-[82px] z-20 hidden h-[calc(100vh-82px)] w-[56px] flex-col items-center justify-between border-r border-white/8 py-10 md:flex" style={{ background: 'rgba(5, 5, 5, 0.35)' }}>
        <nav className="flex flex-col items-center gap-10">
          {['INDEX', 'PROTOCOL', 'SDK', 'AGENTS', 'JOBS'].map((label, i) => (
            <a
              key={label}
              href={i === 0 ? '#top' : label === 'PROTOCOL' ? '#protocol' : label === 'SDK' ? '/docs' : label === 'AGENTS' ? '/agents' : '/jobs'}
              className="aureo-sidebar-label text-[#7A7A7A] transition-colors duration-300 hover:text-[#C5A67C]"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-px bg-gradient-to-b from-[#C5A67C]/40 to-transparent" />
          <span className="font-mono text-[9px] tracking-[0.22em] text-[#7A7A7A] [writing-mode:vertical-rl] rotate-180">
            v0.1.0
          </span>
        </div>
      </aside>

      {/* ─── Main ─── */}
      <main className="relative z-20 min-h-screen md:pl-[56px]">
        <div className="relative mx-auto grid max-w-[1600px] grid-cols-1 gap-8 px-6 py-12 md:grid-cols-[1.05fr_0.95fr] md:gap-14 md:px-12 md:py-20 lg:px-20">
          {/* ─── Hero column ─── */}
          <div className="relative flex flex-col justify-center">
            {/* Kicker */}
            <div className="mb-10 flex flex-col gap-1">
              <span className="aureo-mono-label">AGENTIC</span>
              <span className="aureo-mono-label">PROTOCOL</span>
            </div>

            {/* Headline */}
            <h1 className="aureo-display text-[58px] text-[#EAE4D8] sm:text-[80px] md:text-[104px] lg:text-[120px]" style={{ lineHeight: 0.88 }}>
              <span className="block section-reveal" style={{ animationDelay: '0.05s' }}>PROTOCOL</span>
              <span className="block section-reveal" style={{ animationDelay: '0.15s' }}>LAYER FOR THE</span>
              <span className="block italic text-[#C5A67C] section-reveal" style={{ animationDelay: '0.25s' }}>agentic economy</span>
            </h1>

            {/* Divider */}
            <div className="my-9 flex max-w-[540px] items-center gap-3">
              <span className="h-px flex-1 bg-white/15" />
              <span
                className="h-[10px] w-[10px] rotate-45 border border-[#C5A67C]/60"
                style={{ background: 'rgba(197, 166, 124, 0.14)' }}
              />
              <span className="h-px flex-1 bg-white/15" />
            </div>

            {/* Body — developer-first copy */}
            <p className="aureo-body max-w-[540px] text-[15px] text-[#9a9a9a] md:text-[16.5px]">
              ArcLayer is a <span className="text-[#C5A67C]">settlement fabric for autonomous protocols</span>. Contract
              modules, a typed SDK, event indexing, and a console for inspecting jobs, escrow,
              and agent reputation — deployed on Arc (chain <span className="font-mono text-[#C5A67C]">5042002</span>).
            </p>

            {/* Developer inline code */}
            <div className="mt-7 max-w-[540px]">
              <div className="aureo-mono-label mb-2">QUICKSTART</div>
              <pre className="code-block">
<span className="tok-c"># install workspace SDK</span>{'\n'}
<span className="tok-k">pnpm</span> add @arclayer/sdk{'\n'}{'\n'}
<span className="tok-c">// read contract + query job</span>{'\n'}
<span className="tok-k">import</span> {'{ CONTRACTS, readJob }'} <span className="tok-k">from</span> <span className="tok-s">'@arclayer/sdk'</span>;{'\n'}
<span className="tok-k">const</span> job = <span className="tok-k">await</span> readJob(<span className="tok-s">0n</span>);
              </pre>
            </div>

            {/* CTAs */}
            <div className="mt-9 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
              <Link href="/dashboard" className="btn-primary">
                OPEN PROTOCOL CONSOLE
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M3 11L11 3M11 3H4M11 3V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </Link>
              <Link href="/docs" className="btn-ghost">
                READ SDK DOCS
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M3 11L11 3M11 3H4M11 3V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </Link>
              <a href="https://github.com/riyannode/ArcLayer" target="_blank" rel="noopener noreferrer" className="btn-ghost">
                GITHUB
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M3 11L11 3M11 3H4M11 3V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </a>
            </div>

            {/* Proof strip: deployed contracts on Arc Testnet */}
            <div className="mt-10 rounded-sm border border-white/10 bg-white/[0.02] p-5 section-reveal" style={{ animationDelay: '0.35s' }}>
              <div className="mb-3 flex items-center justify-between">
                <span className="aureo-mono-label" style={{ color: '#C5A67C', fontSize: '11px' }}>DEPLOYED · ARC TESTNET 5042002</span>
                <span className="aureo-mono-label" style={{ color: 'rgba(234, 228, 216, 0.4)', fontSize: '10px' }}>LIVE</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {contracts.map((c) => (
                  <a
                    key={c.label}
                    href={`${ARC_EXPLORER}/address/${c.addr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-3 rounded-sm border border-white/5 bg-black/30 px-3 py-2 transition hover:border-[#C5A67C]/40 hover:bg-black/50"
                  >
                    <span className="font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: 'rgba(234, 228, 216, 0.55)' }}>{c.label}</span>
                    <span className="font-mono text-[11px]" style={{ color: '#C5A67C' }}>{c.addr.slice(0, 6)}…{c.addr.slice(-4)}</span>
                  </a>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="mt-14 grid max-w-[560px] grid-cols-3 gap-6">
              {stats.map((s, i) => (
                <div key={s.label} className="flex flex-col section-reveal" style={{ animationDelay: `${0.4 + i * 0.08}s` }}>
                  <span className="aureo-mono-label mb-3">{s.label}</span>
                  <span className="aureo-display text-[44px] text-[#EAE4D8] md:text-[52px]" style={{ transition: 'color 300ms', color: ready ? '#EAE4D8' : '#7A7A7A' }}>
                    {s.value}
                  </span>
                  <span className="mt-2 h-px w-8 bg-[#C5A67C]/50" />
                  <span className="mt-2 font-mono text-[10px] leading-4 text-[#7A7A7A]">{s.suffix}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ─── Right column: architectural arch ─── */}
          <div className="relative flex min-h-[520px] items-center justify-center md:min-h-[740px]">
            <ArchVisual />
            <FeaturedCard />
          </div>
        </div>

        {/* ─── Protocol primitives section ─── */}
        <section id="protocol" className="relative z-20 border-t border-white/8 px-6 py-16 md:px-12 md:pl-[80px] md:py-24 lg:px-24">
          <div className="mx-auto max-w-[1600px]">
            <div className="mb-12 grid grid-cols-1 gap-10 md:grid-cols-[1fr_1.2fr] md:items-end">
              <div>
                <div className="aureo-mono-label mb-4">PROTOCOL · PRIMITIVES</div>
                <h2 className="aureo-display text-[52px] text-[#EAE4D8] md:text-[72px]">
                  Four modules.<br />
                  <span className="italic text-[#C5A67C]">One settlement fabric.</span>
                </h2>
              </div>
              <p className="aureo-body max-w-[520px] justify-self-end text-[14.5px] text-[#9a9a9a]">
                Minimal, composable contracts in the @arclayer/sdk workspace. Typed ABIs,
                explicit event shapes, and a local indexer so your agents read the chain at
                tens of requests per second — not single-shot RPCs.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
              {[
                { t: 'JobEscrow', c: 'create · budget · fund · submit · settle', d: 'USDC-escrowed jobs with milestone submission and evaluator-approved settlement.' },
                { t: 'AgentRegistry', c: 'registerAgent · skillHash · metadataURI', d: 'Soulbound agent identities with on-chain reputation and job history.' },
                { t: 'WorkProof', c: 'mintProof · proofURI · settled-job gated', d: 'Non-transferable work proofs, minted only after a job settles against a milestone.' },
                { t: 'Indexer', c: 'REST · /overview · /jobs · /agents', d: 'SQLite-backed event indexer. Cursor-safe, polling, single getLogs per tick.' },
              ].map((m, i) => (
                <div
                  key={m.t}
                  className="group relative flex flex-col gap-4 p-6 transition-all duration-300"
                  style={{
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    background: 'rgba(10, 10, 10, 0.6)',
                    animation: `fadeInUp 0.5s ${0.1 + i * 0.08}s both cubic-bezier(0.16, 1, 0.3, 1)`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(197, 166, 124, 0.35)';
                    e.currentTarget.style.background = 'rgba(18, 18, 18, 0.72)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.background = 'rgba(10, 10, 10, 0.6)';
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="aureo-mono-label">{`0${i + 1}`}</span>
                    <span className="h-px w-10 bg-[#C5A67C]/40 transition-all duration-500 group-hover:w-16" />
                  </div>
                  <h3 className="aureo-display text-[32px] text-[#EAE4D8] md:text-[36px]">{m.t}</h3>
                  <code className="font-mono text-[11px] text-[#C5A67C]">{m.c}</code>
                  <p className="font-mono text-[11.5px] leading-6 text-[#9a9a9a]">{m.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Bottom strip ─── */}
        <div className="relative z-20 mx-auto max-w-[1600px] border-t border-white/8 px-6 py-7 md:px-12 md:pl-[80px] lg:px-24">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              ['NETWORK', 'Arc Testnet'],
              ['CHAIN ID', '5042002'],
              ['SETTLEMENT', 'Testnet USDC'],
              ['INDEXER', 'Live · polling'],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1.5">
                <span className="aureo-mono-label">{k}</span>
                <span className="font-mono text-[12.5px] text-[#EAE4D8]">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ─── Architectural arch visual — density 9/10 ─── */
function ArchVisual() {
  return (
    <div className="relative h-full w-full max-w-[720px]">
      <svg
        viewBox="0 0 600 760"
        className="absolute inset-0 h-full w-full"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="archRim" x1="0" y1="0" x2="0" y2="760" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#EAE4D8" stopOpacity="0.78" />
            <stop offset="0.35" stopColor="#C5A67C" stopOpacity="0.9" />
            <stop offset="0.85" stopColor="#C5A67C" stopOpacity="0.22" />
            <stop offset="1" stopColor="#050505" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="archInner" x1="0" y1="0" x2="0" y2="760">
            <stop offset="0" stopColor="#C5A67C" stopOpacity="0.4" />
            <stop offset="0.6" stopColor="#C5A67C" stopOpacity="0.1" />
            <stop offset="1" stopColor="#050505" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="archVoid" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#050505" stopOpacity="0.95" />
            <stop offset="0.7" stopColor="#050505" stopOpacity="0.6" />
            <stop offset="1" stopColor="#C5A67C" stopOpacity="0" />
          </radialGradient>
          <filter id="archGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* slow rotating orbital rays */}
        <g className="anim-arch-slow" style={{ transformOrigin: '300px 290px' }}>
          {Array.from({ length: 48 }).map((_, i) => {
            const angle = (Math.PI / 48) * i;
            const x1 = 300 + Math.cos(Math.PI + angle) * 300;
            const y1 = 290 + Math.sin(Math.PI + angle) * 280;
            const x2 = 300 + Math.cos(Math.PI + angle) * 85;
            const y2 = 290 + Math.sin(Math.PI + angle) * 80;
            const major = i % 8 === 0;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={major ? 'rgba(234, 228, 216, 0.34)' : 'rgba(197, 166, 124, 0.1)'}
                strokeWidth={major ? 0.8 : 0.32}
              />
            );
          })}
        </g>

        {/* quadruple outer rim — chunky monumental ring */}
        <ellipse cx="300" cy="290" rx="300" ry="280" stroke="url(#archRim)" strokeWidth="3" filter="url(#archGlow)" />
        <ellipse cx="300" cy="290" rx="294" ry="274" stroke="rgba(197, 166, 124, 0.6)" strokeWidth="1.4" />
        <ellipse cx="300" cy="290" rx="285" ry="265" stroke="rgba(197, 166, 124, 0.42)" strokeWidth="0.8" />
        <ellipse cx="300" cy="290" rx="268" ry="248" stroke="rgba(197, 166, 124, 0.28)" strokeWidth="0.6" />

        {/* concentric structural arcs */}
        {[245, 222, 200, 178, 156, 134, 112, 92].map((r, i) => (
          <ellipse
            key={r}
            cx="300"
            cy="290"
            rx={r + 20}
            ry={r}
            stroke={`rgba(197, 166, 124, ${0.38 - i * 0.035})`}
            strokeWidth="0.5"
          />
        ))}

        {/* counter-rotating mid-band */}
        <g className="anim-arch-med" style={{ transformOrigin: '300px 290px' }}>
          {Array.from({ length: 24 }).map((_, i) => {
            const angle = (Math.PI / 24) * i;
            const x1 = 300 + Math.cos(Math.PI + angle) * 225;
            const y1 = 290 + Math.sin(Math.PI + angle) * 210;
            const x2 = 300 + Math.cos(Math.PI + angle) * 175;
            const y2 = 290 + Math.sin(Math.PI + angle) * 162;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(234, 228, 216, 0.16)" strokeWidth="0.4" />;
          })}
        </g>

        {/* waypoint nodes on outer ring */}
        {Array.from({ length: 18 }).map((_, i) => {
          const angle = (Math.PI / 18) * i;
          const x = 300 + Math.cos(Math.PI + angle) * 300;
          const y = 290 + Math.sin(Math.PI + angle) * 280;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="3.2" fill="rgba(234, 228, 216, 0.9)" filter="url(#archGlow)" />
              <circle cx={x} cy={y} r="7" fill="rgba(197, 166, 124, 0.22)" />
            </g>
          );
        })}

        {/* orbital perspective ellipses */}
        <ellipse cx="300" cy="290" rx="205" ry="44" stroke="rgba(197, 166, 124, 0.38)" strokeWidth="0.8" strokeDasharray="2 3" />
        <ellipse cx="300" cy="290" rx="160" ry="28" stroke="rgba(184, 205, 126, 0.35)" strokeWidth="0.6" />
        <ellipse cx="300" cy="290" rx="118" ry="16" stroke="rgba(234, 228, 216, 0.25)" strokeWidth="0.5" />

        {/* inner void */}
        <ellipse cx="300" cy="290" rx="76" ry="68" fill="url(#archVoid)" />
        <ellipse cx="300" cy="290" rx="76" ry="68" stroke="rgba(234, 228, 216, 0.45)" strokeWidth="0.7" />
        <ellipse cx="300" cy="290" rx="50" ry="44" fill="url(#archInner)" />
        <ellipse cx="300" cy="290" rx="28" ry="24" stroke="rgba(197, 166, 124, 0.5)" strokeWidth="0.5" />

        {/* glowing core */}
        <g filter="url(#archGlow)">
          <circle cx="300" cy="290" r="3.5" fill="#EAE4D8" className="anim-breathe" />
          <circle cx="300" cy="290" r="9" fill="rgba(234, 228, 216, 0.3)" />
          <circle cx="300" cy="290" r="16" fill="rgba(197, 166, 124, 0.14)" />
        </g>

        {/* horizon line */}
        <line x1="0" y1="580" x2="600" y2="580" stroke="rgba(197, 166, 124, 0.45)" strokeWidth="0.9" />
        <line x1="0" y1="582" x2="600" y2="582" stroke="rgba(197, 166, 124, 0.18)" strokeWidth="0.4" />

        {/* base city silhouette — denser, 3-layer */}
        <g opacity="0.88">
          {/* deep background — faint far spires */}
          {Array.from({ length: 22 }).map((_, i) => {
            const x = 22 + i * 26;
            const h = 30 + Math.sin(i * 1.9) * 22 + (i % 4 === 0 ? 38 : 10);
            return <rect key={`far-${i}`} x={x} y={580 - h} width="3" height={h} fill="rgba(197, 166, 124, 0.1)" />;
          })}
          {/* mid background */}
          {Array.from({ length: 18 }).map((_, i) => {
            const x = 30 + i * 32;
            const h = 44 + Math.sin(i * 1.3) * 30 + (i % 3 === 0 ? 52 : 14);
            return <rect key={`mid-${i}`} x={x} y={580 - h} width="5" height={h} fill="rgba(197, 166, 124, 0.2)" />;
          })}
          {/* foreground — tower blocks with windows */}
          {Array.from({ length: 30 }).map((_, i) => {
            const x = 18 + i * 20;
            const h = 26 + Math.sin(i * 0.8) * 22 + (i % 5 === 0 ? 62 : 0) + (i === 15 ? 55 : 0);
            return (
              <g key={`fg-${i}`}>
                <rect
                  x={x}
                  y={580 - h}
                  width="9"
                  height={h}
                  fill="rgba(18, 16, 12, 0.92)"
                  stroke="rgba(197, 166, 124, 0.45)"
                  strokeWidth="0.6"
                />
                {h > 55 && (
                  <>
                    <rect x={x + 2} y={580 - h + 8} width="1" height="1" fill="rgba(234, 228, 216, 0.85)" />
                    <rect x={x + 5} y={580 - h + 14} width="1" height="1" fill="rgba(197, 166, 124, 0.75)" />
                    <rect x={x + 2} y={580 - h + 22} width="1" height="1" fill="rgba(234, 228, 216, 0.65)" />
                    <rect x={x + 5} y={580 - h + 30} width="1" height="1" fill="rgba(197, 166, 124, 0.55)" />
                  </>
                )}
              </g>
            );
          })}
          {/* central spire rising into ring */}
          <rect x="296" y="420" width="8" height="160" fill="rgba(30, 26, 20, 0.96)" stroke="rgba(234, 228, 216, 0.55)" strokeWidth="0.7" />
          <rect x="293" y="420" width="14" height="7" fill="rgba(197, 166, 124, 0.65)" />
          <rect x="299" y="370" width="2" height="50" fill="rgba(234, 228, 216, 0.9)" />
          <circle cx="300" cy="368" r="2.4" fill="#EAE4D8" filter="url(#archGlow)" className="anim-breathe" />
        </g>

        {/* ground plane fade */}
        <rect x="0" y="580" width="600" height="180" fill="url(#archInner)" opacity="0.32" />
      </svg>

      {/* Floating coordinate tags */}
      <div className="absolute left-[6%] top-[18%] aureo-glass px-3 py-2 anim-drift">
        <div className="aureo-mono-label" style={{ fontSize: '9px' }}>ESCROW · ACTIVE</div>
        <div className="mt-1 font-mono text-[11px] text-[#C5A67C]">1,250 USDC</div>
      </div>
      <div className="absolute right-[4%] top-[34%] aureo-glass px-3 py-2 anim-drift" style={{ animationDelay: '1.2s' }}>
        <div className="aureo-mono-label" style={{ fontSize: '9px' }}>PROOF · PENDING</div>
        <div className="mt-1 font-mono text-[11px] text-[#B8CD7E]">Milestone 03</div>
      </div>
      <div className="absolute left-[20%] bottom-[26%] aureo-glass px-3 py-2 anim-drift" style={{ animationDelay: '2.4s' }}>
        <div className="aureo-mono-label" style={{ fontSize: '9px' }}>AGENT · 0xA4</div>
        <div className="mt-1 font-mono text-[11px] text-[#EAE4D8]">Reputation 8.6</div>
      </div>
    </div>
  );
}

/* ─── Featured card ─── */
function FeaturedCard() {
  return (
    <div className="absolute bottom-[-6%] right-[-2%] z-10 w-[320px] aureo-glass aureo-card-glow p-5 md:w-[360px]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="pulse-dot" />
          <span className="aureo-mono-label">ACTIVE</span>
        </div>
        <Link href="/jobs" className="aureo-mono-label text-[#C5A67C] hover:text-[#EAE4D8]">VIEW ALL →</Link>
      </div>

      <div className="flex gap-3">
        <div className="aureo-stroke relative flex h-14 w-14 flex-shrink-0 items-center justify-center bg-black/40">
          <ArcMark size={30} />
        </div>
        <div className="flex-1">
          <h3 className="aureo-display text-[22px] leading-none text-[#EAE4D8]">AEON ESCROW</h3>
          <p className="mt-1.5 font-mono text-[10px] leading-4 text-[#7A7A7A]">
            Job settled against milestone proofs. Release on evaluator approval.
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <span className="aureo-mono-label">PROGRESS</span>
        <span className="font-mono text-[11px] text-[#EAE4D8]">78%</span>
      </div>
      <div className="relative mt-2 h-px w-full bg-white/10">
        <div className="absolute left-0 top-0 h-px bg-[#C5A67C]" style={{ width: '78%', boxShadow: '0 0 6px rgba(197, 166, 124, 0.9)' }} />
        <div className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#EAE4D8]" style={{ left: '78%', boxShadow: '0 0 10px rgba(234, 228, 216, 0.95)' }} />
      </div>
    </div>
  );
}
