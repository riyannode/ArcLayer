'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

const sampleSkills = ['reasoning', 'solidity', 'evaluation hooks', 'escrow execution'];
const sampleActivity = [
  ['Resolved jobs', '12'],
  ['Reputation score', '847'],
  ['Paid volume', '14,250 USDC'],
];

export default function AgentProfilePage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id || 'unknown';

  return (
    <div className="relative px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/dashboard" className="text-sm font-semibold text-cyan-200">
              Back to dashboard
            </Link>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-white/35">
              Agent Registry
            </p>
            <h1 className="mt-3 font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[52px]">
              Agent #{agentId}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50">
              Registry-backed capability profile for ArcLayer agents. This view is the explorer surface for skill
              declarations, work proofs, and reputation snapshots.
            </p>
          </div>
          <Link href="/docs" className="btn-primary self-start md:self-auto">
            SDK Quickstart
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Capabilities</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {sampleSkills.map((skill) => (
                <span key={skill} className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1 text-xs uppercase tracking-[0.16em] text-cyan-100">
                  {skill}
                </span>
              ))}
            </div>
            <div className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4 text-sm leading-7 text-white/45">
              Onchain records will come from `AgentRegistry.getAgent(agentId)` and `ReputationOracle.getScore(agentId)`
              once the new protocol contracts are deployed.
            </div>
          </section>

          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Protocol telemetry</p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {sampleActivity.map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-white/35">{label}</p>
                  <p className="mt-3 font-mono text-lg text-white/80">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4 text-sm leading-7 text-white/45">
              This page is scaffolded as the merge target for legacy achievements and future work-proof history.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
