'use client';

import { useState } from 'react';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useRail, type Rail } from './RailProvider';

const OPTIONS: Array<{
  rail: Rail;
  label: string;
  title: string;
  body: string;
  accent: string;
}> = [
  {
    rail: 'native',
    label: 'ARC NATIVE',
    title: 'Self-hosted x402 rail',
    body: 'Use Arc native EIP-3009 verification and self-hosted settlement. Best for direct protocol-native flows.',
    accent: '#C5A67C',
  },
  {
    rail: 'gateway',
    label: 'CIRCLE GATEWAY',
    title: 'Batched Gateway rail',
    body: 'Use Circle Gateway batched EIP-3009. Best for batched USDC payment authorization and settlement.',
    accent: '#22d3ee',
  },
];

export default function RailOnboardingModal() {
  const { isConnected, address } = useArcWallet();
  const { rail, hydrated, loading, error, selectRail } = useRail();
  const [pending, setPending] = useState<Rail | null>(null);

  if (!isConnected || !address || !hydrated || rail) return null;

  async function choose(next: Rail) {
    setPending(next);
    try {
      await selectRail(next);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 px-4 pb-4 backdrop-blur-sm sm:items-center sm:pb-0">
      <div className="w-full max-w-3xl border border-white/10 bg-[#070707] p-5 shadow-2xl sm:p-7">
        <div className="mb-5 flex flex-col gap-3 border-b border-white/10 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="aureo-mono-label mb-2">ONE-TIME RAIL LOCK</div>
            <h2 className="aureo-display text-[30px] text-[#EAE4D8] sm:text-[42px]">
              Choose your <span className="italic text-[#C5A67C]">payment rail</span>
            </h2>
            <p className="mt-2 max-w-xl font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.78)] invisible">
              This choice is locked for the wallet session. Deposit, allocate, settle, withdraw, dispute,
              and every job created from this wallet must use the same rail.
            </p>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-[rgba(234,228,216,0.55)]">
            {address.slice(0, 6)}…{address.slice(-4)}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {OPTIONS.map((option) => (
            <button
              key={option.rail}
              type="button"
              onClick={() => choose(option.rail)}
              disabled={loading || pending !== null}
              className="group border border-white/10 bg-white/[0.02] p-5 text-left transition-all hover:bg-white/[0.045] disabled:cursor-wait disabled:opacity-70"
              style={{ ['--rail-accent' as string]: option.accent }}
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center border border-white/10 bg-black/40 text-[var(--rail-accent)]">
                {option.rail === 'native' ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
                    <path d="M12 8v8" />
                    <path d="M8.5 10.25 12 8l3.5 2.25" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12a7 7 0 0 1 12.25-4.63" />
                    <path d="M19 12a7 7 0 0 1-12.25 4.63" />
                    <path d="M17 4.5v4h-4" />
                    <path d="M7 19.5v-4h4" />
                  </svg>
                )}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--rail-accent)]">
                {option.label}
              </div>
              <h3 className="mt-2 text-lg font-semibold text-[#EAE4D8]">{option.title}</h3>
              <p className="mt-2 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.78)] invisible">{option.body}</p>
              <div className="mt-5 flex items-center gap-2 font-mono text-[11px] text-[var(--rail-accent)] group-hover:text-[#EAE4D8]">
                {pending === option.rail ? 'Locking rail…' : 'Select and lock'}
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 border border-red-500/20 bg-red-500/10 p-3 font-mono text-[11px] text-red-200">
            {error.startsWith('rail_locked:')
              ? `Rail already locked to ${error.split(':')[1]}. Synced local state.`
              : error}
          </div>
        )}
      </div>
    </div>
  );
}
