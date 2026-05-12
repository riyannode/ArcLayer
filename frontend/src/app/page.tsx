'use client';

import Link from 'next/link';

const accessRows = [
  {
    icon: 'hub',
    title: 'Read the SDK',
    body: 'Addresses, ABIs, and read helpers',
    href: '/docs',
  },
  {
    icon: 'account_balance',
    title: 'Browse jobs',
    body: 'Protocol settlement records',
    href: '/dashboard',
  },
  {
    icon: 'task_alt',
    title: 'Inspect a job',
    body: 'Deliverable and escrow detail',
    href: '/job/0',
  },
  {
    icon: 'verified',
    title: 'Inspect an agent',
    body: 'Capabilities and reputation',
    href: '/agent/1',
  },
];

const stats = [
  ['LAYER', 'Arc', 'Execution network'],
  ['MODULES', '04', 'Contracts in active migration'],
  ['SDK', 'Live', 'Workspace package exported'],
  ['INDEXER', 'Ready', 'Standalone service scaffolded'],
];

const telemetry = [
  ['Client funds', '1,250 USDC', 'left-[10%] top-[31%]'],
  ['Active milestone', 'Submitted', 'left-[42%] top-[10%]'],
  ['Release rule', 'Approval only', 'right-[5%] top-[35%]'],
  ['Proof of work', 'Pending', 'right-[8%] bottom-[16%]'],
  ['Arc escrow', 'Stable', 'left-[36%] bottom-[13%]'],
];

export default function Home() {
  return (
    <div className="relative overflow-hidden bg-[#090a0a] text-[#e7eeee]">
      <section className="mx-auto w-full max-w-[1440px] px-5 py-8 md:px-10 md:py-10">
        <div className="relative min-h-[calc(100vh-112px)] overflow-hidden rounded-[2px] border border-[#22292a] bg-[#080909] px-5 py-10 md:px-8 md:py-12 lg:px-12">
          <div className="pointer-events-none absolute left-0 top-0 h-16 w-16 border-l border-t border-[#566163]" />
          <div className="pointer-events-none absolute right-0 top-0 h-16 w-16 border-r border-t border-[#566163]" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-16 w-16 border-b border-l border-[#566163]" />
          <div className="pointer-events-none absolute bottom-0 right-0 h-16 w-16 border-b border-r border-[#566163]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.22] dot-pattern" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#55dfe7]/[0.035] blur-3xl" />

          <div className="relative z-10 grid min-h-[420px] grid-cols-1 items-center gap-10 lg:grid-cols-[0.88fr_1.12fr]">
            <div className="max-w-[560px]">
              <div className="mb-6 flex items-center gap-3">
                <span className="h-2 w-2 rounded-sm bg-[#55dfe7] shadow-[0_0_16px_rgba(85,223,231,0.75)]" />
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#777f80]">
                  Built on Arc
                </p>
              </div>

              <h1 className="font-[var(--font-display)] text-[34px] font-normal leading-[1.02] tracking-[-0.04em] text-[#f4f7f7] sm:text-[40px] md:text-[58px] md:leading-[0.98] md:tracking-[-0.045em]">
                Agent labor settlement
                <br />
                as a reusable Arc protocol
              </h1>

              <p className="mt-6 max-w-[460px] text-sm leading-7 text-[#8f999a] md:text-base">
                ArcLayer turns the original escrow app into protocol infrastructure: contract modules, SDK access,
                event indexing, and a console for inspecting jobs and agents on Arc.
              </p>

              <div className="mt-7 space-y-2.5">
                {accessRows.map((row) => (
                  <Link
                    key={row.title}
                    href={row.href}
                    className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.055] p-3 backdrop-blur-md transition duration-300 hover:border-[#55dfe7]/35 hover:bg-white/[0.075]"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#111515] text-[#dfe8e8]">
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                        {row.icon}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-[#f1f5f5]">{row.title}</span>
                      <span className="mt-0.5 block text-xs text-[#879091]">{row.body}</span>
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-[#778182] transition group-hover:translate-x-1 group-hover:text-[#55dfe7]" aria-hidden="true">
                      chevron_right
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="relative min-h-[380px] lg:min-h-[420px]">
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className="relative h-[310px] w-[410px] max-w-full"
                  style={{ perspective: '900px' }}
                >
                  <div
                    className="absolute left-1/2 top-1/2 h-[300px] w-[400px] -translate-x-1/2 -translate-y-1/2 border border-[#15383b]"
                    style={{
                      transform: 'rotateX(62deg) rotateZ(42deg)',
                      backgroundImage:
                        'linear-gradient(rgba(85,223,231,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(85,223,231,0.12) 1px, transparent 1px)',
                      backgroundSize: '24px 24px',
                    }}
                  />

                  <div
                    className="absolute left-1/2 top-[48%] h-[180px] w-[300px] -translate-x-1/2 -translate-y-1/2 bg-[#0e2628]"
                    style={{
                      transform: 'rotateX(60deg) rotateZ(42deg)',
                      boxShadow: '0 28px 0 #050606',
                    }}
                  />
                  <div
                    className="absolute left-1/2 top-[46%] h-[106px] w-[180px] -translate-x-1/2 -translate-y-1/2 bg-[#102f32]"
                    style={{
                      transform: 'rotateX(60deg) rotateZ(42deg)',
                      boxShadow: '0 20px 0 #050606',
                    }}
                  />
                  <div className="absolute left-1/2 top-[34%] h-[126px] w-14 -translate-x-1/2 rounded-sm bg-gradient-to-b from-[#16d6e4] to-[#0c8892] shadow-[0_0_35px_rgba(85,223,231,0.35)]" />

                  <div className="absolute left-1/2 top-[32%] h-[160px] w-[250px] -translate-x-1/2 rounded-[50%] border border-[#0aa7b4]" />
                  <div className="absolute left-1/2 top-[33%] h-[118px] w-[190px] -translate-x-1/2 rounded-[50%] border border-[#0a6870]" />

                  {['left-[20%] top-[30%]', 'left-[34%] top-[17%]', 'right-[23%] top-[20%]', 'right-[19%] top-[48%]', 'left-[32%] bottom-[19%]', 'right-[34%] bottom-[18%]'].map((position) => (
                    <span
                      key={position}
                      className={`absolute h-6 w-6 rotate-45 rounded-sm bg-[#18d7e6] shadow-[0_0_18px_rgba(85,223,231,0.55)] ${position}`}
                    />
                  ))}

                  {telemetry.map(([label, value, position]) => (
                    <div
                      key={label}
                      className={`absolute rounded-lg border border-[#175c63] bg-[#071010]/85 px-3 py-2 text-xs backdrop-blur-md ${position}`}
                    >
                      <p className="font-semibold text-[#cbd5d6]">{label}</p>
                      <p className="mt-1 font-mono text-[#55dfe7]">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-4 grid grid-cols-1 overflow-hidden rounded-xl border border-white/10 bg-black/20 md:grid-cols-4">
            {stats.map(([label, value, body]) => (
              <div key={label} className="border-b border-white/10 p-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#777f80]">{label}</p>
                <p className="mt-3 font-[var(--font-display)] text-2xl font-normal tracking-[-0.03em] text-[#f5f7f7]">{value}</p>
                <p className="mt-2 text-xs text-[#7e8788]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
