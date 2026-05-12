'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { useReadContract, useReadContracts } from 'wagmi';
import {
  CONTRACTS,
  MILESTONE_ESCROW_ABI,
  MILESTONE_STATUS,
  PROJECT_STATUS,
  formatUSDC,
  getExplorerAddressUrl,
  shortenAddress,
} from '@/lib/contracts';
import { ESCROW_CONFIGURED, type MilestoneTuple, type ProjectTuple, milestoneFromTuple, projectFromTuple } from '@/lib/escrow';

function parseProjectId(value: string | undefined) {
  try {
    return value && /^\d+$/.test(value) ? BigInt(value) : BigInt(0);
  } catch {
    return BigInt(0);
  }
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = parseProjectId(params.id);

  const { data: rawProject, isLoading } = useReadContract({
    address: CONTRACTS.MILESTONE_ESCROW,
    abi: MILESTONE_ESCROW_ABI,
    functionName: 'projects',
    args: [projectId],
    query: { enabled: ESCROW_CONFIGURED },
  });

  const project = rawProject ? projectFromTuple(rawProject as ProjectTuple) : null;
  const milestoneCount = project?.milestoneCount || 0;

  const milestoneContracts = useMemo(
    () =>
      Array.from({ length: milestoneCount }, (_, milestoneId) => ({
        address: CONTRACTS.MILESTONE_ESCROW,
        abi: MILESTONE_ESCROW_ABI,
        functionName: 'milestones',
        args: [projectId, BigInt(milestoneId)] as const,
      })),
    [milestoneCount, projectId]
  );

  const { data: milestoneReads } = useReadContracts({
    contracts: milestoneContracts,
    query: { enabled: ESCROW_CONFIGURED && milestoneCount > 0 },
  });

  const milestones =
    milestoneReads
      ?.filter((read) => read.status === 'success' && read.result)
      .map((read) => milestoneFromTuple(read.result as unknown as MilestoneTuple)) || [];

  const releasedCount = milestones.filter((milestone) => milestone.status === 3).length;
  const submittedCount = milestones.filter((milestone) => milestone.status >= 2).length;
  const isMissingProject = project && project.freelancer === '0x0000000000000000000000000000000000000000';

  return (
    <div className="relative px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/dashboard" className="text-sm font-semibold text-cyan-200">
              Back to dashboard
            </Link>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-white/35">
              Project #{projectId.toString()}
            </p>
            <h1 className="mt-3 font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[52px]">
              {project?.title || 'Onchain project'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50">
              {project?.description || 'Live MilestoneEscrow state will appear here after deployment and project creation.'}
            </p>
          </div>
          <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3">
            <p className="text-xs text-white/40">Locked escrow</p>
            <p className="mt-1 font-mono text-lg font-semibold text-cyan-100">
              {project ? `${formatUSDC(project.totalAmount)} USDC` : '0.00 USDC'}
            </p>
          </div>
        </div>

        {!ESCROW_CONFIGURED && (
          <div className="mb-6 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
            MilestoneEscrow address is not configured yet. Deploy V1 and update the frontend contract address.
          </div>
        )}

        {isMissingProject && (
          <div className="mb-6 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
            Project #{projectId.toString()} was not found on the configured escrow contract.
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            ['Status', project ? PROJECT_STATUS[project.status] : isLoading ? 'Loading' : 'Unavailable'],
            ['Submitted', `${submittedCount} / ${milestoneCount}`],
            ['Released', `${releasedCount} / ${milestoneCount}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{label}</p>
              <p className="mt-2 font-mono text-lg text-white/75">{value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Project receipt</p>
            <div className="mt-5 space-y-3">
              {[
                ['Client', project ? shortenAddress(project.client) : '0x...'],
                ['Freelancer', project ? shortenAddress(project.freelancer) : '0x...'],
                ['Released', project ? `${formatUSDC(project.releasedAmount)} USDC` : '0.00 USDC'],
                ['Contract', ESCROW_CONFIGURED ? shortenAddress(CONTRACTS.MILESTONE_ESCROW) : 'Not deployed'],
              ].map(([label, value]) => (
                <div key={label} className="ledger-row flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                  <span className="text-sm text-white/45">{label}</span>
                  <span className="font-mono text-sm text-white/75">{value}</span>
                </div>
              ))}
            </div>
            {ESCROW_CONFIGURED && (
              <a href={getExplorerAddressUrl(CONTRACTS.MILESTONE_ESCROW)} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex text-sm font-semibold text-cyan-200">
                View escrow contract
              </a>
            )}
          </section>

          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Milestones</p>
            <div className="mt-5 space-y-3">
              {milestones.length > 0 ? (
                milestones.map((milestone) => (
                  <div key={milestone.id.toString()} className="ledger-row rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-white">{milestone.title}</p>
                        <p className="mt-1 font-mono text-xs text-white/40">{formatUSDC(milestone.amount)} USDC</p>
                      </div>
                      <span className={milestone.status === 3 ? 'text-sm text-cyan-200' : 'text-sm text-white/55'}>
                        {MILESTONE_STATUS[milestone.status]}
                      </span>
                    </div>
                    {milestone.deliverableURI && (
                      <p className="mt-3 truncate font-mono text-xs text-white/35">{milestone.deliverableURI}</p>
                    )}
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/45">
                  No milestones loaded yet.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
