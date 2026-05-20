'use client';

import { useState } from 'react';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useVaultJob, type VaultJobStep } from '@/hooks/useVaultJob';
import type { Address } from 'viem';

type Milestone = {
  description: string;
  amount: string; // USDC string
};

type DurationTier = 'single_payout' | 'milestone';

const MIN_MILESTONE_BPS = 1000; // 10%

export function VaultDepositPanel() {
  const { address, isConnected } = useArcWallet();
  const { state, createVaultJob, reset } = useVaultJob();
  const [jobberAddr, setJobberAddr] = useState('');
  const [specJson, setSpecJson] = useState('');
  const [durationTier, setDurationTier] = useState<DurationTier>('single_payout');
  const [milestones, setMilestones] = useState<Milestone[]>([{ description: '', amount: '' }]);

  const totalAmount = milestones.reduce((sum, m) => {
    const n = Number(m.amount);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

  // Bond preview (matches BondConfig.sol tiers — should fetch from chain in prod)
  const bondPreview = computeBond(totalAmount);

  function addMilestone() {
    setMilestones((prev) => [...prev, { description: '', amount: '' }]);
  }

  function removeMilestone(i: number) {
    if (milestones.length <= 1) return;
    setMilestones((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateMilestone(i: number, field: keyof Milestone, value: string) {
    setMilestones((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));
  }

  async function handleCreate() {
    if (!isConnected || !address) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(jobberAddr)) return;
    if (!specJson.trim()) return;
    if (totalAmount <= 0) return;

    // Validate min 10% per milestone for milestone-tier jobs
    if (durationTier === 'milestone') {
      const minPerMs = totalAmount * (MIN_MILESTONE_BPS / 10000);
      for (const m of milestones) {
        if (Number(m.amount) < minPerMs) return;
      }
    }

    try {
      await createVaultJob({
        jobberAddress: jobberAddr as Address,
        totalAmount: totalAmount.toString(),
        milestones: milestones.map((m) => ({
          amount: m.amount,
          description: m.description,
        })),
        specJson: { description: specJson },
      });
    } catch {
      // error already in state
    }
  }

  const stepLabels: Record<VaultJobStep, string> = {
    idle: 'Configure milestones and deposit USDC into Vault.',
    allowance: 'Checking USDC allowance…',
    approving: 'Approve USDC spend in wallet…',
    depositing: 'Depositing USDC to Vault 1 (Open Pool)…',
    creating: 'Creating job on-chain (allocating V1 → job)…',
    indexing: 'Indexing job in database…',
    done: state.message,
    error: state.message,
  };

  const stepTone: Record<VaultJobStep, 'idle' | 'pending' | 'success' | 'error'> = {
    idle: 'idle',
    allowance: 'pending',
    approving: 'pending',
    depositing: 'pending',
    creating: 'pending',
    indexing: 'pending',
    done: 'success',
    error: 'error',
  };

  const tone = stepTone[state.step];
  const toneClass = {
    idle: 'border-white/10 bg-black/20 text-[rgba(234,228,216,0.82)]',
    pending: 'border-amber-400/30 bg-amber-400/5 text-amber-200',
    success: 'border-[#B8CD7E]/35 bg-[#B8CD7E]/8 text-[#B8CD7E]',
    error: 'border-red-400/35 bg-red-400/6 text-red-200',
  }[tone];

  const busy = !['idle', 'done', 'error'].includes(state.step);

  return (
    <div className="aureo-panel p-4 md:p-6">
      <div className="aureo-mono-label mb-2">VAULT · ON-CHAIN ESCROW</div>
      <h2 className="aureo-display text-[28px] text-[#EAE4D8]">
        Multi-milestone <span className="italic text-[#C5A67C]">vault deposit</span>
      </h2>
      <p className="mt-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.78)] invisible">
        Dual-vault system: V1 (Open Pool, instant withdraw) → V2 (Escrow Lock, locked on jobber accept). Auto-resolved disputes via AI · 7-tier performance bond · 48hr approval window.
      </p>

      {/* Tier selector */}
      <div className="mt-5">
        <label className="mb-2 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">VAULT JOB TYPE</label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: 'single_payout' as const, label: '5min–24hr', sub: 'Single payout' },
              { id: 'milestone' as const, label: '> 24hr', sub: 'Milestone-based' },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setDurationTier(t.id);
                if (t.id !== 'milestone') setMilestones((prev) => [prev[0] || { description: '', amount: '' }]);
              }}
              className={`rounded-none border px-3 py-2.5 text-left transition-colors ${
                durationTier === t.id
                  ? 'border-[#C5A67C] bg-[#C5A67C]/10 text-[#EAE4D8]'
                  : 'border-white/10 bg-black/20 text-[rgba(234,228,216,0.78)] hover:border-white/25'
              }`}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.14em]">{t.label}</div>
              <div className="mt-1 font-mono text-[9.5px] text-[rgba(234,228,216,0.6)]">{t.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Jobber + Spec */}
      <div className="mt-5 space-y-4">
        <div>
          <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">JOBBER WALLET</label>
          <input
            value={jobberAddr}
            onChange={(e) => setJobberAddr(e.target.value)}
            placeholder="0x... worker / executor wallet"
            className="input-mono"
            spellCheck={false}
          />
        </div>

        <div>
          <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">SPEC / TASK DESCRIPTION</label>
          <textarea
            value={specJson}
            onChange={(e) => setSpecJson(e.target.value)}
            placeholder="Describe deliverables, acceptance criteria, file format. AI resolver uses this if disputed."
            className="input-mono min-h-[100px]"
          />
        </div>
      </div>

      {/* Milestones */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <label className="block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">
            {durationTier === 'milestone' ? 'MILESTONES (2–5)' : 'PAYOUT'}
          </label>
          {durationTier === 'milestone' && milestones.length < 5 && (
            <button
              type="button"
              onClick={addMilestone}
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]"
            >
              + Add Milestone
            </button>
          )}
        </div>

        <div className="space-y-2">
          {milestones.map((m, i) => (
            <div key={i} className="flex gap-2 rounded-none border border-white/10 bg-black/20 px-3 py-2.5">
              <span className="mt-2 font-mono text-[10px] text-[rgba(234,228,216,0.5)]">#{i + 1}</span>
              <div className="flex-1 space-y-2">
                <input
                  value={m.description}
                  onChange={(e) => updateMilestone(i, 'description', e.target.value)}
                  placeholder="Milestone description (e.g. 'Initial wireframes')"
                  className="input-mono"
                />
                <div className="flex items-center gap-2">
                  <input
                    value={m.amount}
                    onChange={(e) => updateMilestone(i, 'amount', e.target.value)}
                    placeholder="0.00"
                    type="number"
                    step="0.01"
                    min="0"
                    className="input-mono flex-1"
                  />
                  <span className="font-mono text-[11px] text-[rgba(234,228,216,0.6)]">USDC</span>
                </div>
              </div>
              {durationTier === 'milestone' && milestones.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMilestone(i)}
                  className="font-mono text-[14px] text-[rgba(234,228,216,0.4)] transition-colors hover:text-red-400"
                  title="Remove"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {durationTier === 'milestone' && (
          <p className="mt-2 font-mono text-[9.5px] text-[rgba(234,228,216,0.5)] invisible">
            Each milestone must be ≥ 10% of total. 2× free revisions per milestone before auto-escalation to AI resolver.
          </p>
        )}
      </div>

      {/* Bond + Total preview */}
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-none border border-white/10 bg-black/20 px-3 py-2.5">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.6)]">Total Deposit</div>
          <div className="mt-1 font-mono text-[14px] text-[#EAE4D8]">${totalAmount.toFixed(2)}</div>
          <div className="font-mono text-[9.5px] text-[rgba(234,228,216,0.5)]">Vault 1 (Open Pool)</div>
        </div>
        <div className="rounded-none border border-white/10 bg-black/20 px-3 py-2.5">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.6)]">Jobber Bond</div>
          <div className="mt-1 font-mono text-[14px] text-[#EAE4D8]">${bondPreview.bondAmount.toFixed(2)}</div>
          <div className="font-mono text-[9.5px] text-[rgba(234,228,216,0.5)]">{bondPreview.tier}</div>
        </div>
        <div className="rounded-none border border-white/10 bg-black/20 px-3 py-2.5">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.6)]">Dispute SLA</div>
          <div className="mt-1 font-mono text-[14px] text-[#EAE4D8]">~5 min</div>
          <div className="font-mono text-[9.5px] text-[rgba(234,228,216,0.5)]">AI Tier 0 (auto)</div>
        </div>
      </div>

      {/* Progress steps indicator */}
      {busy && (
        <div className="mt-4 flex items-center gap-2">
          {(['allowance', 'approving', 'depositing', 'creating', 'indexing'] as VaultJobStep[]).map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className={`h-2 w-2 rounded-full ${
                state.step === s ? 'animate-pulse bg-amber-400' :
                (['allowance', 'approving', 'depositing', 'creating', 'indexing'].indexOf(state.step) > i ? 'bg-[#B8CD7E]' : 'bg-white/20')
              }`} />
              <span className="font-mono text-[8px] uppercase text-[rgba(234,228,216,0.5)]">
                {s === 'allowance' ? 'CHK' : s === 'approving' ? 'APR' : s === 'depositing' ? 'DEP' : s === 'creating' ? 'JOB' : 'IDX'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tx hashes */}
      {(state.txApprove || state.txDeposit || state.txCreate) && (
        <div className="mt-3 space-y-1 font-mono text-[9.5px] text-[rgba(234,228,216,0.6)]">
          {state.txApprove && <div>Approve: <span className="text-[#C5A67C]">{state.txApprove.slice(0, 10)}…{state.txApprove.slice(-6)}</span></div>}
          {state.txDeposit && <div>Deposit: <span className="text-[#C5A67C]">{state.txDeposit.slice(0, 10)}…{state.txDeposit.slice(-6)}</span></div>}
          {state.txCreate && <div>Create: <span className="text-[#C5A67C]">{state.txCreate.slice(0, 10)}…{state.txCreate.slice(-6)}</span></div>}
        </div>
      )}

      {/* Status */}
      <div className={`mt-4 rounded-none border px-4 py-3 font-mono text-[11px] ${toneClass}`}>
        {stepLabels[state.step]}
      </div>

      <div className="mt-5 flex gap-3">
        <button
          onClick={handleCreate}
          disabled={!isConnected || busy}
          className="btn-primary flex-1"
        >
          {busy ? 'PROCESSING…' : state.step === 'done' ? 'CREATE ANOTHER' : 'DEPOSIT & CREATE VAULT JOB'}
        </button>
        {state.step === 'error' && (
          <button onClick={reset} className="btn-secondary px-4">
            RETRY
          </button>
        )}
      </div>
    </div>
  );
}

// Mirror BondConfig.sol tier logic
function computeBond(totalUsd: number): { bondAmount: number; tier: string } {
  if (totalUsd === 0) return { bondAmount: 0, tier: '—' };
  if (totalUsd < 50) return { bondAmount: 0, tier: 'Free tier' };
  if (totalUsd < 300) return { bondAmount: 5, tier: '$5 flat' };
  if (totalUsd < 500) return { bondAmount: totalUsd * 0.01, tier: '1% rate' };
  if (totalUsd < 1000) return { bondAmount: totalUsd * 0.02, tier: '2% rate' };
  if (totalUsd < 2000) return { bondAmount: totalUsd * 0.03, tier: '3% rate' };
  if (totalUsd < 3000) return { bondAmount: totalUsd * 0.045, tier: '4.5% rate' };
  return { bondAmount: totalUsd * 0.06, tier: '6% rate (max)' };
}
