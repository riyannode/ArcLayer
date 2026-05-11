'use client';

export default function Footer() {
  const links = [
    { label: 'Escrows', href: '/invoice' },
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Work Proof', href: '/achievements' },
    { label: 'Trust Layer', href: '/#trust' },
  ];

  return (
    <footer className="relative z-10 w-full border-t border-[#2d3a3b] bg-[#0d0f0f] px-6 py-14 md:px-10">
      <div className="mx-auto max-w-screen-2xl">
        <div className="mb-10 flex flex-col gap-5 rounded-xl border border-[#2d3a3b] bg-[#141818] p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-[var(--font-display)] text-2xl font-semibold tracking-[-0.02em] text-[#f2ffff]">
              Create your first escrow project
            </p>
            <p className="mt-2 text-sm text-[#9aa7a8]">
              Preview the flow, then connect when you are ready to settle work on Arc.
            </p>
          </div>
          <a href="/invoice" className="btn-primary self-start md:self-auto">
            Start escrow
          </a>
        </div>
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div className="text-center text-sm font-semibold text-[#b9cacb] md:text-left">
            © 2026 ArcWork Protocol. USDC milestone settlement on Arc.
          </div>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-[#8a9596]">
            {links.map((link) => (
              <a key={link.label} href={link.href} className="transition-colors hover:text-[#dbfcff]">
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
