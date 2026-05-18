'use client';

import Link from 'next/link';
import { AGENT_CATEGORIES } from './categories';

function Chip({ children, tone = 'cyan' }: { children: React.ReactNode; tone?: 'cyan' | 'green' | 'amber' | 'violet' }) {
  const tones = {
    cyan: 'border-[#C5A67C]/35 bg-[#C5A67C]/10 text-[#C5A67C]',
    green: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    amber: 'border-amber-400/30 bg-amber-400/10 text-[#C5A67C]',
    violet: 'border-violet-400/30 bg-violet-400/10 text-[#D7C7AA]',
  };
  return <span className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones[tone]}`}>{children}</span>;
}

function MetricCard({ label, value, sub, tone = 'cyan' }: { label: string; value: string; sub: string; tone?: 'cyan' | 'green' | 'amber' | 'violet' }) {
  const valueTone = {
    cyan: 'text-[#C5A67C]',
    green: 'text-emerald-300',
    amber: 'text-[#C5A67C]',
    violet: 'text-[#D7C7AA]',
  }[tone];
  return (
    <div className="min-w-[150px] flex-1 border-r border-white/10 bg-black/20 px-4 py-3 last:border-r-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/60">{label}</div>
      <div className={`mt-1 font-mono text-lg font-bold ${valueTone}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-[#EAE4D8]/50">{sub}</div>
    </div>
  );
}

export default function LiveA2AAgentPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-4">
        <header className="overflow-hidden rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90">
          <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">ARCLAYER · A2A</div>
              <h1 className="mt-1 text-3xl font-black uppercase tracking-[0.16em] text-[#EAE4D8] sm:text-3xl">LIVE A2A AGENT</h1>
              <p className="mt-1 max-w-3xl text-sm text-[#EAE4D8]">
                Choose an agent category. The live backend flow opens on its own page, like Jobs and Register.
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Chip tone="green">PAY AGENT</Chip>
              <Chip tone="cyan">WORK RECEIPT</Chip>
              <Chip tone="amber">REPUTATION</Chip>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap">
            <MetricCard label="Total Requests" value="24" sub="agent calls + scans" tone="cyan" />
            <MetricCard label="Total USDC Volume" value="$0.18" sub="x402 + escrow settled" tone="green" />
            <MetricCard label="Total Agents" value="12" sub="available categories" tone="violet" />
            <MetricCard label="Completed Jobs" value="3" sub="settled work receipts" tone="amber" />
          </div>
        </header>

        <section className="overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A]/90 backdrop-blur-xl">
          <div className="flex h-10 items-center gap-2 border-b border-white/10 bg-black/30 px-3">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
            <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#EAE4D8]">Agent Categories</h2>
            <div className="ml-auto"><Chip tone="cyan">12 ROUTES</Chip></div>
          </div>

          <div className="p-4">
            <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/60">
              Click a category to open the agent flow page
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {AGENT_CATEGORIES.map((cat) => {
                const isLive = cat.status === 'LIVE';
                return (
                  <Link
                    key={cat.key}
                    href={`/live-a2a-agent/${cat.key}`}
                    className="group relative flex min-h-[142px] flex-col gap-2 rounded-sm border border-white/10 bg-black/25 p-3 text-left transition hover:border-[#C5A67C]/35 hover:bg-white/[0.04]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 bg-black/40 ${isLive ? 'text-[#C5A67C]' : 'text-[#EAE4D8]/45'}`}>
                        <span className="block h-4 w-4">{cat.icon}</span>
                      </div>
                      <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider ${isLive ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-300' : 'border-white/15 bg-white/5 text-[#EAE4D8]/55'}`}>
                        {cat.status}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#EAE4D8]">{cat.label}</div>
                    <div className="line-clamp-2 text-[10.5px] leading-snug text-[#EAE4D8]/60">{cat.tagline}</div>
                    <div className="mt-auto flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-[#C5A67C]">
                      Open page <span className="transition group-hover:translate-x-0.5">→</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
