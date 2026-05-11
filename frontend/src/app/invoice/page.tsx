'use client';

import { FormEvent, useMemo, useState } from 'react';
import { isAddress } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import {
  CONTRACTS,
  MILESTONE_ESCROW_ABI,
  USDC_ABI,
  getExplorerTxUrl,
  parseUSDC,
  shortenAddress,
} from '@/lib/contracts';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ESCROW_CONFIGURED = (CONTRACTS.MILESTONE_ESCROW as string) !== ZERO_ADDRESS;

type MilestoneInput = {
  title: string;
  amount: string;
};

const defaultMilestones: MilestoneInput[] = [
  { title: 'Initial delivery', amount: '250' },
  { title: 'Final handoff', amount: '750' },
];

const wizardSteps = ['Project details', 'Milestones', 'Review escrow', 'Create on Arc', 'Operate'];

export default function InvoicePage() {
  const { address, isConnected } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const [client, setClient] = useState('');
  const [title, setTitle] = useState('Landing page redesign');
  const [description, setDescription] = useState('Design, build, and hand off a new landing page.');
  const [milestones, setMilestones] = useState<MilestoneInput[]>(defaultMilestones);
  const [wizardStep, setWizardStep] = useState(0);

  const [projectId, setProjectId] = useState('0');
  const [fundAmount, setFundAmount] = useState('1000');
  const [milestoneId, setMilestoneId] = useState('0');
  const [deliverableURI, setDeliverableURI] = useState('https://example.com/delivery');

  const activeMilestones = useMemo(
    () => milestones.filter((milestone) => milestone.title.trim() && Number(milestone.amount) > 0),
    [milestones]
  );

  const totalAmount = useMemo(
    () => activeMilestones.reduce((sum, milestone) => sum + Number(milestone.amount || 0), 0),
    [activeMilestones]
  );

  const updateMilestone = (index: number, key: keyof MilestoneInput, value: string) => {
    setMilestones((current) =>
      current.map((milestone, milestoneIndex) =>
        milestoneIndex === index ? { ...milestone, [key]: value } : milestone
      )
    );
  };

  const removeMilestone = (index: number) => {
    setMilestones((current) =>
      current.length > 1 ? current.filter((_, milestoneIndex) => milestoneIndex !== index) : current
    );
  };

  const submitCreateProject = () => {
    if (!ESCROW_CONFIGURED || !isAddress(client) || activeMilestones.length === 0) return;

    writeContract({
      address: CONTRACTS.MILESTONE_ESCROW,
      abi: MILESTONE_ESCROW_ABI,
      functionName: 'createProject',
      args: [
        client as `0x${string}`,
        title.trim(),
        description.trim(),
        activeMilestones.map((milestone) => milestone.title.trim()),
        activeMilestones.map((milestone) => parseUSDC(milestone.amount)),
      ],
    });
  };

  const createProject = (event: FormEvent) => {
    event.preventDefault();
    submitCreateProject();
  };

  const canContinue =
    wizardStep === 0
      ? isAddress(client) && title.trim().length > 0 && description.trim().length > 0
      : wizardStep === 1
        ? activeMilestones.length > 0
        : true;

  const goNext = () => setWizardStep((step) => Math.min(step + 1, wizardSteps.length - 1));
  const goBack = () => setWizardStep((step) => Math.max(step - 1, 0));

  const approveUSDC = () => {
    if (!ESCROW_CONFIGURED || Number(fundAmount) <= 0) return;

    writeContract({
      address: CONTRACTS.USDC,
      abi: USDC_ABI,
      functionName: 'approve',
      args: [CONTRACTS.MILESTONE_ESCROW, parseUSDC(fundAmount)],
    });
  };

  const fundProject = () => {
    if (!ESCROW_CONFIGURED || projectId.trim() === '') return;

    writeContract({
      address: CONTRACTS.MILESTONE_ESCROW,
      abi: MILESTONE_ESCROW_ABI,
      functionName: 'fundProject',
      args: [BigInt(projectId)],
    });
  };

  const submitMilestone = () => {
    if (!ESCROW_CONFIGURED || projectId.trim() === '' || milestoneId.trim() === '') return;

    writeContract({
      address: CONTRACTS.MILESTONE_ESCROW,
      abi: MILESTONE_ESCROW_ABI,
      functionName: 'submitMilestone',
      args: [BigInt(projectId), BigInt(milestoneId), deliverableURI.trim()],
    });
  };

  const approveMilestone = () => {
    if (!ESCROW_CONFIGURED || projectId.trim() === '' || milestoneId.trim() === '') return;

    writeContract({
      address: CONTRACTS.MILESTONE_ESCROW,
      abi: MILESTONE_ESCROW_ABI,
      functionName: 'approveMilestone',
      args: [BigInt(projectId), BigInt(milestoneId)],
    });
  };

  const projectDetailsStep = (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-2 block text-xs font-light uppercase tracking-[0.18em] text-white/35">Client wallet</span>
        <input
          value={client}
          onChange={(event) => setClient(event.target.value)}
          placeholder="0x..."
          className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-light text-white outline-none transition focus:border-cyan-300/40"
        />
        {client && !isAddress(client) && <p className="mt-2 text-xs text-amber-200/80">Use a valid 0x wallet address.</p>}
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-light uppercase tracking-[0.18em] text-white/35">Project title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-light text-white outline-none transition focus:border-cyan-300/40"
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-light uppercase tracking-[0.18em] text-white/35">Scope</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={5}
          className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-light leading-7 text-white outline-none transition focus:border-cyan-300/40"
        />
      </label>
    </div>
  );

  const milestonesStep = (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Milestones</span>
        <button
          type="button"
          onClick={() => setMilestones((current) => [...current, { title: '', amount: '' }])}
          className="rounded-md border border-white/10 px-3 py-1 text-xs text-white/55 transition hover:border-cyan-300/30 hover:text-cyan-200"
        >
          Add
        </button>
      </div>
      <div className="space-y-3">
        {milestones.map((milestone, index) => (
          <div key={index} className="ledger-row grid grid-cols-1 gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3 md:grid-cols-[1fr_150px_auto]">
            <input
              value={milestone.title}
              onChange={(event) => updateMilestone(index, 'title', event.target.value)}
              placeholder={`Milestone ${index + 1}`}
              className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm font-light text-white outline-none transition focus:border-cyan-300/40"
            />
            <input
              value={milestone.amount}
              onChange={(event) => updateMilestone(index, 'amount', event.target.value)}
              inputMode="decimal"
              placeholder="USDC"
              className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm font-light text-white outline-none transition focus:border-cyan-300/40"
            />
            <button
              type="button"
              onClick={() => removeMilestone(index)}
              disabled={milestones.length === 1}
              aria-label={`Delete milestone ${index + 1}`}
              className="rounded-lg border border-red-300/15 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-red-100/70 transition hover:border-red-300/35 hover:bg-red-300/10 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-30 md:self-stretch"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );

  const reviewStep = (
    <div className="space-y-3">
      {[
        ['Client', isAddress(client) ? shortenAddress(client) : '0x client wallet'],
        ['Project', title || 'Untitled project'],
        ['Milestones', `${activeMilestones.length}`],
        ['Total locked', `${totalAmount.toLocaleString()} USDC`],
        ['Settlement', 'Arc Testnet'],
      ].map(([label, value]) => (
        <div key={label} className="ledger-row flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3">
          <span className="text-sm text-white/45">{label}</span>
          <span className="max-w-[58%] truncate text-right font-mono text-sm text-white/75">{value}</span>
        </div>
      ))}
      <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] p-4 text-sm leading-6 text-cyan-50/80">
        Client funds the full escrow first. Each payout only releases after the matching milestone is approved.
      </div>
    </div>
  );

  const createOnArcStep = (
    <form onSubmit={createProject} className="space-y-5">
      <div className="rounded-lg border border-white/10 bg-black/20 p-5">
        <p className="text-xs uppercase tracking-[0.18em] text-white/35">Ready to create</p>
        <h2 className="mt-2 font-[var(--font-display)] text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-white/50">
          This sends project terms and milestone amounts to MilestoneEscrow on Arc.
        </p>
      </div>
      <button
        type="submit"
        disabled={!ESCROW_CONFIGURED || isPending || !isAddress(client) || activeMilestones.length === 0}
        className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-40"
      >
        Create on Arc
      </button>
    </form>
  );

  const operateStep = (
    <div className="space-y-5">
      <p className="text-sm leading-7 text-white/45">
        After creation, use the emitted project ID for funding, submission, and release.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-2 block text-xs font-light uppercase tracking-[0.18em] text-white/35">Project ID</span>
          <input value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none" />
        </label>
        <label className="block">
          <span className="mb-2 block text-xs font-light uppercase tracking-[0.18em] text-white/35">Milestone ID</span>
          <input value={milestoneId} onChange={(event) => setMilestoneId(event.target.value)} className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none" />
        </label>
      </div>
      <label className="block">
        <span className="mb-2 block text-xs font-light uppercase tracking-[0.18em] text-white/35">Funding amount</span>
        <input value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} inputMode="decimal" className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none" />
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-light uppercase tracking-[0.18em] text-white/35">Delivery link</span>
        <input value={deliverableURI} onChange={(event) => setDeliverableURI(event.target.value)} className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none" />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button onClick={approveUSDC} disabled={!ESCROW_CONFIGURED || isPending} className="btn-ghost disabled:opacity-40">Approve USDC</button>
        <button onClick={fundProject} disabled={!ESCROW_CONFIGURED || isPending} className="btn-ghost disabled:opacity-40">Fund Project</button>
        <button onClick={submitMilestone} disabled={!ESCROW_CONFIGURED || isPending} className="btn-ghost disabled:opacity-40">Submit Milestone</button>
        <button onClick={approveMilestone} disabled={!ESCROW_CONFIGURED || isPending} className="btn-ghost disabled:opacity-40">Release after approval</button>
      </div>
    </div>
  );

  const wizardPanels = [projectDetailsStep, milestonesStep, reviewStep, createOnArcStep, operateStep];

  if (!isConnected) {
    return (
      <div className="relative px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/70">Try without wallet</p>
            <h1 className="font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[48px]">
              Preview a project before connecting
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50">
              Review the V1 workflow first. Connect a wallet only when you are ready to create the project on Arc.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-white/35">Project terms</p>
              <h2 className="mt-3 text-2xl font-semibold">Brand site redesign</h2>
              <p className="mt-3 text-sm leading-7 text-white/50">
                Design, build, and hand off a polished landing page with onchain milestone settlement.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <p className="text-xs text-white/35">Client</p>
                  <p className="mt-2 font-mono text-sm">0x8A31...91F2</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <p className="text-xs text-white/35">Total locked</p>
                  <p className="mt-2 font-mono text-sm">1,250 USDC</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-white/35">Milestones</p>
              <div className="mt-4 space-y-3">
                {[
                  ['Project details', 'Scope and client wallet confirmed'],
                  ['Milestones', 'Three deliverables totaling 1,250 USDC'],
                  ['Review escrow', 'Client funds contract before work starts'],
                  ['Create on Arc', 'Project ID and tx hash generated'],
                  ['Release', 'Payment settles after approval'],
                ].map(([label, body], index) => (
                  <div key={label} className="grid grid-cols-[auto_1fr] gap-3 rounded-lg border border-white/10 bg-black/20 p-4">
                    <span className="font-mono text-xs text-cyan-300">0{index + 1}</span>
                    <div>
                      <p className="text-sm font-semibold">{label}</p>
                      <p className="mt-1 text-xs leading-5 text-white/45">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs leading-5 text-white/40">
                Connect wallet from the top navigation to run this flow with real contract calls.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300/70">
            New escrow project
          </p>
          <h1 className="font-[var(--font-display)] text-[36px] font-semibold leading-tight tracking-[-0.03em] md:text-[52px]">Create milestone escrow</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50">
            Connected as {shortenAddress(address || '')}. Define the client and milestones, then have the client fund
            the full USDC amount into Arc escrow.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-5" aria-label="Escrow creation steps">
          {wizardSteps.map((step, index) => (
            <button
              key={step}
              type="button"
              onClick={() => setWizardStep(index)}
              className={`timeline-step rounded-lg border p-4 text-left transition ${
                wizardStep === index
                  ? 'border-cyan-300/35 bg-cyan-300/[0.07]'
                  : index < wizardStep
                    ? 'border-white/10 bg-white/[0.035]'
                    : 'border-white/10 bg-white/[0.02]'
              }`}
              data-active={wizardStep === index}
            >
              <p className={wizardStep === index ? 'font-mono text-xs text-cyan-200' : 'font-mono text-xs text-white/35'}>0{index + 1}</p>
              <p className="mt-2 text-sm font-semibold text-white/80">{step}</p>
            </button>
          ))}
        </div>

        {!ESCROW_CONFIGURED && (
          <div className="mb-8 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5">
            <p className="text-sm font-light text-amber-100">
              Contract address is not configured yet. Deploy MilestoneEscrow and update CONTRACTS.MILESTONE_ESCROW
              before sending transactions.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="glass-card p-6 md:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 font-mono text-xs text-cyan-300">0{wizardStep + 1} / 05</p>
                <h2 className="font-[var(--font-display)] text-xl font-semibold">{wizardSteps[wizardStep]}</h2>
                <p className="mt-2 text-sm text-white/45">
                  {wizardStep === 4 ? 'Operate the escrow after creation.' : 'Complete this step before moving forward.'}
                </p>
              </div>
              <div className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                {totalAmount.toLocaleString()} USDC
              </div>
            </div>

            <div className="min-h-[360px]">{wizardPanels[wizardStep]}</div>

            <div className="mt-8 flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={goBack} disabled={wizardStep === 0} className="btn-ghost disabled:cursor-not-allowed disabled:opacity-35">
                Back
              </button>
              {wizardStep < wizardSteps.length - 1 && (
                <button type="button" onClick={goNext} disabled={!canContinue} className="btn-primary disabled:cursor-not-allowed disabled:opacity-40">
                  Next
                </button>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <div className="glass-card p-6">
              <p className="mb-2 font-mono text-xs text-cyan-300">Escrow preview</p>
              <h2 className="font-[var(--font-display)] text-xl font-semibold">{title}</h2>
              <div className="mt-5 space-y-3">
                {[
                  ['Client', isAddress(client) ? shortenAddress(client) : '0x client wallet'],
                  ['Milestones', `${activeMilestones.length}`],
                  ['Total locked', `${totalAmount.toLocaleString()} USDC`],
                  ['Release rule', 'Client-approved milestone'],
                ].map(([label, value]) => (
                  <div key={label} className="ledger-row flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                    <span className="text-sm text-white/45">{label}</span>
                    <span className="font-mono text-sm text-white/70">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card p-6">
              <h2 className="text-xl font-light">Transaction status</h2>
              <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm font-light leading-7 text-white/45">
                {isPending && 'Waiting for wallet confirmation.'}
                {isConfirming && 'Transaction submitted. Waiting for Arc confirmation.'}
                {isSuccess && hash && (
                  <a href={getExplorerTxUrl(hash)} target="_blank" rel="noopener noreferrer" className="text-cyan-200">
                    Confirmed on ArcScan
                  </a>
                )}
                {!isPending && !isConfirming && !isSuccess && 'No transaction in progress.'}
              </div>
              {error && (
                <p className="mt-4 rounded-lg border border-red-300/20 bg-red-300/10 p-4 text-xs font-light leading-6 text-red-100">
                  {error.message}
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
