'use client';

/**
 * Home sidebar — AUREO-style slim vertical nav fixed to the left edge.
 * Labels use vertical writing mode; keeps the landing visually anchored.
 * Hidden on mobile, visible on md+.
 */
const items = [
  { label: 'INDEX', href: '#top' },
  { label: 'PROTOCOL', href: '/protocol' },
  { label: 'SDK', href: '/docs' },
  { label: 'AGENTS', href: '/agents' },
  { label: 'JOBS', href: '/jobs' },
  { label: 'A2A', href: '/a2a' },
];

export default function HomeSidebar() {
  return (
    <aside
      className="fixed left-0 top-[82px] z-20 hidden h-[calc(100vh-82px)] w-[56px] flex-col items-center justify-between border-r border-white/8 py-10 md:flex"
      style={{ background: 'rgba(5, 5, 5, 0.35)' }}
      aria-label="Landing sidebar"
    >
      <nav className="flex flex-col items-center gap-10">
        {items.map((it) => (
          <a
            key={it.label}
            href={it.href}
            className="aureo-sidebar-label text-[#7A7A7A] transition-colors duration-300 hover:text-[#C5A67C]"
          >
            {it.label}
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
  );
}
