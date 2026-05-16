'use client';

/**
 * HomeWhoIsThisFor — explains the two integration paths visually.
 * Sits below the protocol section on the landing page.
 */

import Link from 'next/link';

const personas = [
  {
    label: 'API / Agent Builders',
    path: 'Path A · x402',
    desc: 'Charge for API calls or agent runs. Users pay USDC before the resource unlocks — no subscriptions, no invoices.',
    flow: ['Client calls API', '402 Payment Required', 'Client signs payment', 'Resource unlocks'],
    color: '#C5A67C',
    cta: { text: 'See x402 docs', href: '/docs#path-a-x402' },
  },
  {
    label: 'Work Orchestrators',
    path: 'Path B · Escrow',
    desc: 'Assign accountable work to agents. USDC is held in escrow until the client approves the deliverable.',
    flow: ['Create job', 'Fund escrow', 'Agent submits work', 'Approve → settle'],
    color: '#7CB5C5',
    cta: { text: 'See escrow docs', href: '/docs#path-b-escrow' },
  },
];

export default function HomeWhoIsThisFor() {
  return (
    <section className="mt-20 mb-12">
      <div className="aureo-mono-label mb-6" style={{ color: '#C5A67C' }}>
        WHO IS THIS FOR
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {personas.map((p) => (
          <div
            key={p.label}
            className="border border-white/10 bg-gradient-to-br from-[rgba(14,14,14,0.8)] to-[rgba(5,5,5,0.6)] p-5 transition hover:border-[rgba(197,166,124,0.25)]"
          >
            <div className="aureo-mono-label mb-1" style={{ color: p.color }}>
              {p.path}
            </div>
            <h3 className="aureo-display text-xl mb-2" style={{ color: '#EAE4D8' }}>
              {p.label}
            </h3>
            <p className="text-sm mb-4" style={{ color: 'rgba(234, 228, 216, 0.68)', lineHeight: 1.55 }}>
              {p.desc}
            </p>

            {/* Simple flow diagram */}
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              {p.flow.map((step, i) => (
                <span key={step} className="flex items-center gap-1.5">
                  <span
                    className="text-[10px] font-mono px-2 py-1 border"
                    style={{
                      color: p.color,
                      borderColor: `${p.color}33`,
                      backgroundColor: `${p.color}0A`,
                    }}
                  >
                    {step}
                  </span>
                  {i < p.flow.length - 1 && (
                    <span className="text-[10px]" style={{ color: 'rgba(234,228,216,0.35)' }}>→</span>
                  )}
                </span>
              ))}
            </div>

            <Link
              href={p.cta.href}
              className="text-[10px] font-medium uppercase tracking-[0.18em] transition hover:opacity-80"
              style={{ color: p.color }}
            >
              {p.cta.text} →
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
