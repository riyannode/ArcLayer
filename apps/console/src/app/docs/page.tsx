import Link from 'next/link';

const quickstart = [
  'Install the workspace SDK package.',
  'Read contract addresses and ABIs from @arclayer/sdk.',
  'Create jobs or inspect project history using the exported client helpers.',
  'Use the indexer service for cached protocol reads when RPC fanout becomes expensive.',
];

export default function DocsPage() {
  return (
    <div className="relative px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/70">
          Developer docs
        </p>
        <h1 className="font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[52px]">
          ArcLayer SDK quickstart
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-white/50">
          The repo now exposes a workspace SDK, a standalone indexer package, and a console app. The protocol contract
          layer is still in staged migration from `MilestoneEscrow` toward `JobEscrow`, so this quickstart documents the
          current working seam.
        </p>

        <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.035] p-6">
          <pre className="overflow-x-auto text-sm text-cyan-100">
{`import { CONTRACTS, readProject } from '@arclayer/sdk'

const project = await readProject(0n)
console.log(CONTRACTS.MILESTONE_ESCROW, CONTRACTS.JOB_ESCROW, project)`}
          </pre>
        </div>

        <div className="mt-8 grid gap-3">
          {quickstart.map((item, index) => (
            <div key={item} className="rounded-lg border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-white/35">Step {index + 1}</p>
              <p className="mt-2 text-sm text-white/70">{item}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard" className="btn-primary">
            Open console
          </Link>
          <Link href="/job/0" className="rounded-md border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:border-cyan-300/30 hover:text-cyan-200">
            Inspect sample job
          </Link>
        </div>
      </div>
    </div>
  );
}
