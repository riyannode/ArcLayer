'use client';

import { useEffect, useState } from 'react';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useGatewayDeposit } from '@/hooks/useGatewayDeposit';
import { DEFAULT_GATEWAY_DEPOSIT_USDC } from '@/lib/x402/constants';
import { shortenAddress } from '@/lib/contracts';

interface GatewayDepositSheetProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const STEP_LABEL: Record<string, string> = {
  idle: 'Ready',
  checking: 'Checking balance',
  approving: 'Approving USDC',
  depositing: 'Depositing to Gateway',
  confirming: 'Confirming',
  success: 'Deposit complete',
  error: 'Deposit failed',
};

export default function GatewayDepositSheet({
  open,
  onClose,
  onSuccess,
}: GatewayDepositSheetProps) {
  const { isConnected, address, mode } = useArcWallet();
  const [amount, setAmount] = useState<string>(DEFAULT_GATEWAY_DEPOSIT_USDC);

  const deposit = useGatewayDeposit(() => {
    onSuccess?.();
  });

  const busy =
    deposit.step === 'checking' ||
    deposit.step === 'approving' ||
    deposit.step === 'depositing' ||
    deposit.step === 'confirming';

  useEffect(() => {
    if (deposit.step !== 'success') return;

    const timer = window.setTimeout(() => {
      onClose();
      deposit.reset();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [deposit.step, deposit, onClose]);

  if (!open) return null;

  const walletLabel =
    mode === 'passkey' ? 'Circle Passkey' : mode === 'eoa' ? 'EOA Wallet' : 'Wallet';

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close deposit modal"
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        onClick={busy ? undefined : onClose}
      />

      <div className="relative w-full max-w-[420px] overflow-hidden rounded-3xl border border-white/10 bg-[#0b0d0f] shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#C5A67C]">
              Circle Gateway
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-white">
              Deposit
            </h2>
            <p className="mt-1 text-xs text-white/50">
              Fund your Gateway balance before buying x402 access.
            </p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full p-2 text-white/45 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4">
          <div className="mb-4 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/30 p-1">
            <button
              type="button"
              className="rounded-xl bg-white/10 px-3 py-3 text-left"
            >
              <div className="text-xs font-semibold text-white">Use Crypto</div>
              <div className="mt-0.5 text-[10px] text-white/45">Arc Testnet USDC</div>
            </button>

            <button
              type="button"
              disabled
              className="rounded-xl px-3 py-3 text-left opacity-40"
            >
              <div className="text-xs font-semibold text-white">Use Cash</div>
              <div className="mt-0.5 text-[10px] text-white/45">Coming soon</div>
            </button>
          </div>

          <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
                Connected
              </span>
              <span className="rounded-full border border-[#C5A67C]/25 bg-[#C5A67C]/10 px-2 py-1 font-mono text-[10px] text-[#C5A67C]">
                {walletLabel}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-mono text-xs text-white">
                  {isConnected && address ? shortenAddress(address) : 'No wallet connected'}
                </div>
                <div className="mt-1 text-[11px] text-white/45">
                  Deposit USDC into Circle Gateway for faster x402 payments.
                </div>
              </div>
            </div>
          </div>

          <div className="mb-4 rounded-2xl border border-white/10 bg-black/25 p-4">
            <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
              Deposit amount
            </label>

            <div className="flex items-center gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy}
                inputMode="decimal"
                className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-3 font-mono text-sm text-white outline-none focus:border-[#C5A67C]/60 disabled:opacity-50"
              />
              <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 font-mono text-xs text-white/70">
                USDC
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {['1.00', '5.00', '10.00'].map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={busy}
                  onClick={() => setAmount(v)}
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-[11px] text-white/70 transition hover:border-[#C5A67C]/40 hover:text-[#C5A67C] disabled:opacity-40"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 space-y-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Transfer USDC</div>
                  <div className="mt-0.5 text-[11px] text-white/45">
                    Send Arc Testnet USDC to your connected wallet first.
                  </div>
                </div>
                <span className="font-mono text-[10px] text-white/40">Step 1</span>
              </div>
            </div>

            <div className="rounded-2xl border border-[#C5A67C]/20 bg-[#C5A67C]/[0.04] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">Deposit to Gateway</div>
                  <div className="mt-0.5 text-[11px] text-white/45">
                    Moves USDC from your wallet into Circle Gateway balance.
                  </div>
                </div>
                <span className="font-mono text-[10px] text-[#C5A67C]">Step 2</span>
              </div>
            </div>
          </div>

          {deposit.error ? (
            <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {deposit.error}
            </div>
          ) : null}

          <button
            type="button"
            disabled={!isConnected || busy || deposit.step === 'success'}
            onClick={() => deposit.deposit(amount)}
            className="w-full rounded-2xl border border-[#C5A67C]/50 bg-[#C5A67C] px-4 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[#050505] transition hover:bg-[#d5b78a] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/50"
          >
            {deposit.step === 'success'
              ? 'Deposit complete'
              : busy
                ? STEP_LABEL[deposit.step] ?? 'Processing'
                : `Deposit ${amount} USDC`}
          </button>

          <div className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
            {STEP_LABEL[deposit.step] ?? 'Ready'}
          </div>
        </div>
      </div>
    </div>
  );
}
