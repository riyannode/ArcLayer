'use client';

import Link from 'next/link';
import { useAccount, useReadContract } from 'wagmi';
import { CONTRACTS, MILESTONE_ESCROW_ABI, shortenAddress } from '@/lib/contracts';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ESCROW_CONFIGURED = CONTRACTS.MILESTONE_ESCROW !== ZERO_ADDRESS;

const operatingStates = [
  { label: 'Created', body: 'Freelancer has drafted project scope and milestones.' },
  { label: 'Funded', body: 'Client has locked USDC into the Arc escrow contract.' },
  { label: 'Submitted', body: 'Freelancer has attached a milestone delivery link.' },
  { label: 'Released', body: 'Client has approved work and USDC has settled.' },
];

const demoProjects = [
  ['Brand site redesign', '0x8A31...91F2', '1,250 USDC', 'Yes', '2 / 3', '1 / 3', 'Pending', '24'],
  ['Launch deck build', '0x19BD...AA04', '640 USDC', 'Yes', '3 / 3', '3 / 3', 'Minted', '18'],
  ['Audit handoff', '0x77E4...20CD', '900 USDC', 'Pending', '0 / 2', '0 / 2', 'None', '31'],
];

export default function Dashboard() {
  const { address, isConnected } = useAccount();

  const { data: projectCounter } = useReadContract({
    address: CONTRACTS.MILESTONE_ESCROW,
    abi: MILESTONE_ESCROW_ABI,
    functionName: 'projectCounter',
    query: { enabled: ESCROW_CONFIGURED },
  });

  const { data: userProjects } = useReadContract({
    address: CONTRACTS.MILESTONE_ESCROW,
    abi: MILESTONE_ESCROW_ABI,
    functionName: 'getUserProjects',
    args: [address || ZERO_ADDRESS],
    query: { enabled: ESCROW_CONFIGURED && Boolean(address) },
  });

  const projectIds = (userProjects || []) as readonly bigint[];

  if (!isConnected) {
    return (
      <div className="relative px-6 py-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/70">
                Try without wallet
              </p>
              <h1 className="font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[48px]">
                Track escrow projects before connecting
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50">
                Grant reviewers and new users can inspect the operating model without a wallet.
              </p>
            </div>
            <Link href="/invoice" className="btn-primary self-start md:self-auto">
              Preview Project Flow
            </Link>
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-white/10 bg-white/[0.035] md:block">
            <table className="w-full table-fixed border-collapse text-left">
              <caption className="sr-only">Escrow projects and milestone status</caption>
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-[0.16em] text-white/35">
                  <th scope="col" className="px-5 py-3 font-semibold">Project</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Client</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Total</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Funded</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Submitted</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Released</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Proof</th>
                </tr>
              </thead>
              <tbody>
                {demoProjects.map((row) => (
                  <tr key={row[0]} className="border-b border-white/5 text-sm last:border-b-0 hover:bg-white/[0.025]">
                    <th scope="row" className="px-5 py-4 font-semibold text-white">
                      <Link href={`/project/${row[7]}`} className="hover:text-cyan-200">{row[0]}</Link>
                    </th>
                    <td className="px-5 py-4 font-mono text-white/55">{row[1]}</td>
                    <td className="px-5 py-4 font-mono text-white/70">{row[2]}</td>
                    {row.slice(3, 7).map((value, index) => (
                      <td key={`${row[7]}-${index}-${value}`} className={`px-5 py-4 ${value === 'Minted' || value === 'Yes' ? 'text-cyan-200' : 'text-white/55'}`}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 md:hidden">
            {demoProjects.map((row) => (
              <Link href={`/project/${row[7]}`} key={row[0]} className="block rounded-xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-white">{row[0]}</p>
                    <p className="mt-1 font-mono text-xs text-white/45">{row[1]}</p>
                  </div>
                  <span className="font-mono text-sm text-cyan-200">{row[2]}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <span className="text-white/45">Funded <b className="text-white/75">{row[3]}</b></span>
                  <span className="text-white/45">Submitted <b className="text-white/75">{row[4]}</b></span>
                  <span className="text-white/45">Released <b className="text-white/75">{row[5]}</b></span>
                  <span className="text-white/45">Proof <b className="text-cyan-200">{row[6]}</b></span>
                </div>
              </Link>
            ))}
          </div>
          <p className="mt-5 text-xs leading-5 text-white/40">
            Connect wallet from the top navigation to replace demo rows with live Arc escrow data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-xs font-light uppercase tracking-[0.24em] text-cyan-300/70">
              Escrow dashboard
            </p>
            <h1 className="text-[36px] font-light leading-tight md:text-[52px]">
              Milestone command center
            </h1>
            <p className="mt-3 text-sm font-light text-white/45">
              {shortenAddress(address || '')} · Arc Testnet
            </p>
          </div>
          <Link href="/invoice" className="btn-primary self-start md:self-auto">
            New Project
          </Link>
        </div>

        {!ESCROW_CONFIGURED && (
          <div className="mb-8 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5">
            <p className="text-sm font-light text-amber-100">
              MilestoneEscrow is not deployed yet. Deploy the V1 contract, then replace
              <span className="font-medium"> CONTRACTS.MILESTONE_ESCROW </span>
              in <span className="font-medium">frontend/src/lib/contracts.ts</span>.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <div className="glass-card p-6">
            <p className="text-xs font-light uppercase tracking-[0.2em] text-white/35">Total projects</p>
            <p className="mt-4 text-4xl font-light">{ESCROW_CONFIGURED ? String(projectCounter || BigInt(0)) : '0'}</p>
          </div>
          <div className="glass-card p-6">
            <p className="text-xs font-light uppercase tracking-[0.2em] text-white/35">Your projects</p>
            <p className="mt-4 text-4xl font-light">{projectIds.length}</p>
          </div>
          <div className="glass-card p-6">
            <p className="text-xs font-light uppercase tracking-[0.2em] text-white/35">Settlement</p>
            <p className="mt-4 text-4xl font-light">USDC</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="glass-card p-6">
            <h2 className="text-lg font-light">Your project IDs</h2>
            <div className="mt-5 space-y-3">
              {projectIds.length > 0 ? (
                projectIds.map((id) => (
                  <Link href={`/project/${id.toString()}`} key={id.toString()} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-cyan-300/30">
                    <span className="text-sm text-white/55">Project #{id.toString()}</span>
                    <span className="text-xs text-cyan-200">Onchain</span>
                  </Link>
                ))
              ) : (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm font-light leading-7 text-white/45">
                  No onchain project IDs found for this wallet yet. Create a project first, then fund it from the client wallet.
                </p>
              )}
            </div>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-lg font-light">V1 operating flow</h2>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {operatingStates.map((state) => (
                <div key={state.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-sm font-medium text-white">{state.label}</p>
                  <p className="mt-2 text-sm font-light leading-6 text-white/45">{state.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
