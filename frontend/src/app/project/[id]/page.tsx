'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

const timeline = [
  {
    label: 'Created',
    body: 'Freelancer defined scope, client wallet, and three milestone payouts.',
    tx: '0x3f1...b29',
    status: 'Complete',
  },
  {
    label: 'Funded',
    body: 'Client locked 1,250 USDC into the ArcWork escrow contract.',
    tx: '0x7b9...e42',
    status: 'Complete',
  },
  {
    label: 'Submitted',
    body: 'Second milestone deliverable was attached for client review.',
    tx: '0xa14...c90',
    status: 'Active',
  },
  {
    label: 'Released',
    body: 'Client approval releases USDC directly to the freelancer wallet.',
    tx: 'Pending',
    status: 'Pending',
  },
  {
    label: 'WorkProof',
    body: 'Completion emits a WorkProofMinted event for reputation and portfolio history.',
    tx: 'Pending',
    status: 'Pending',
  },
];

const milestones = [
  ['Design system refresh', '450 USDC', 'Released'],
  ['Landing implementation', '500 USDC', 'Submitted'],
  ['Final handoff', '300 USDC', 'Funded'],
];

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id || '24';

  return (
    <div className="relative px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/dashboard" className="text-sm font-semibold text-cyan-200">
              Back to dashboard
            </Link>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-white/35">
              Project #{projectId}
            </p>
            <h1 className="mt-3 font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[52px]">
              Brand site redesign
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50">
              A demo project detail view showing contract state, milestone progress, transaction history, and proof output.
            </p>
          </div>
          <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3">
            <p className="text-xs text-white/40">Locked escrow</p>
            <p className="mt-1 font-mono text-lg font-semibold text-cyan-100">1,250 USDC</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-cyan-300/30 bg-cyan-300/[0.06] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/75">Demo mode</p>
            <p className="mt-2 text-sm leading-6 text-white/60">
              Showing a sample escrow receipt for grant review and product walkthroughs.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Live contract mode</p>
            <p className="mt-2 text-sm leading-6 text-white/50">
              Connect wallet and load contract state by project ID after MilestoneEscrow deployment.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Project receipt</p>
            <div className="mt-5 space-y-3">
              {[
                ['Client', '0x8A31...91F2'],
                ['Freelancer', '0x42CE...C0A8'],
                ['Settlement', 'Arc Testnet'],
                ['Contract', 'MilestoneEscrow'],
              ].map(([label, value]) => (
                <div key={label} className="ledger-row flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                  <span className="text-sm text-white/45">{label}</span>
                  <span className="font-mono text-sm text-white/75">{value}</span>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Milestones</p>
              <div className="mt-3 space-y-3">
                {milestones.map(([name, amount, status]) => (
                  <div key={name} className="ledger-row flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{name}</p>
                      <p className="mt-1 font-mono text-xs text-white/40">{amount}</p>
                    </div>
                    <span className={status === 'Released' ? 'text-sm text-cyan-200' : 'text-sm text-white/55'}>{status}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Escrow timeline</p>
            <div className="mt-5 space-y-4">
              {timeline.map((item, index) => (
                <div key={item.label} className="timeline-step grid grid-cols-[auto_1fr] gap-4" data-active={item.status === 'Active'}>
                  <div className="flex flex-col items-center">
                    <div className={item.status === 'Complete' || item.status === 'Active' ? 'h-8 w-8 rounded-md border border-cyan-300/30 bg-cyan-300/[0.08]' : 'h-8 w-8 rounded-md border border-white/10 bg-white/[0.03]'}>
                      <span className="flex h-full items-center justify-center font-mono text-xs text-cyan-200">0{index + 1}</span>
                    </div>
                    {index < timeline.length - 1 && <div className="h-12 w-px bg-white/10" />}
                  </div>
                  <div className="pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-white">{item.label}</h2>
                      <span className={item.status === 'Active' ? 'text-xs font-semibold text-cyan-200' : 'text-xs text-white/45'}>
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/50">{item.body}</p>
                    <p className="mt-2 font-mono text-xs text-white/35">{item.tx}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
