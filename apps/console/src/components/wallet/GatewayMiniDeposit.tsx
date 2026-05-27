'use client';

import { useMemo, useState } from 'react';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useGatewayBalances } from '@/hooks/useGatewayBalances';
import { useGatewayDeposit } from '@/hooks/useGatewayDeposit';

interface GatewayMiniDepositProps {
  showUnlockButton?: boolean;
  onReadyToUnlock?: () => void | Promise<void>;
}

function formatAmount(value?: string | null) {
  if (!value) return '0.00';

  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';

  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function isIdleLike(step: string) {
  return step === 'idle' || step === 'success' || step === 'error';
}

function atomicGtZero(value?: string | null) {
  try {
    return BigInt(value || '0') > BigInt(0);
  } catch {
    return false;
  }
}

export default function GatewayMiniDeposit({
  showUnlockButton = false,
  onReadyToUnlock,
}: GatewayMiniDepositProps) {
  const wallet = useArcWallet();
  const { balances, loading, error, refresh } = useGatewayBalances();
  const deposit = useGatewayDeposit(refresh);

  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState('1');

  const gatewayReady = useMemo(() => {
    return atomicGtZero(balances?.gatewayAvailableAtomic);
  }, [balances?.gatewayAvailableAtomic]);

  if (!wallet.isConnected) return null;

  const walletUsdc = balances?.walletUsdc || '0';
  const gatewayUsdc = balances?.gatewayAvailableUsdc || '0';

  return (
    <div className="rounded-xl border border-[#C5A67C]/20 bg-[#080808] p-3 font-mono shadow-2xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/35">
            Gateway Balance
          </div>
          <div className="mt-1 text-xs text-[#C5A67C]">
            {loading ? 'Loading…' : `${formatAmount(gatewayUsdc)} USDC`}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-lg border border-[#C5A67C]/35 px-3 py-2 text-[10px] tracking-[0.16em] text-[#C5A67C] hover:bg-[#C5A67C]/10"
        >
          DEPOSIT
        </button>
      </div>

      {showUnlockButton && gatewayReady && onReadyToUnlock && (
        <button
          type="button"
          onClick={onReadyToUnlock}
          className="mt-3 w-full rounded-lg bg-[#EAE4D8] px-3 py-2 text-[10px] tracking-[0.16em] text-black hover:bg-white"
        >
          UNLOCK X402
        </button>
      )}

      {expanded && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/40">
            Deposit to Gateway
          </div>

          <div className="mb-2 text-[10px] text-white/35">
            Wallet USDC: {formatAmount(walletUsdc)}
          </div>

          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!isIdleLike(deposit.step)}
            inputMode="decimal"
            placeholder="1.00"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#C5A67C]/50 disabled:opacity-50"
          />

          <div className="mt-2 flex gap-2">
            {['1', '5', '10'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset)}
                disabled={!isIdleLike(deposit.step)}
                className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/45 hover:border-[#C5A67C]/40 hover:text-[#C5A67C] disabled:opacity-50"
              >
                {preset}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setAmount(walletUsdc)}
              disabled={!isIdleLike(deposit.step)}
              className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/45 hover:border-[#C5A67C]/40 hover:text-[#C5A67C] disabled:opacity-50"
            >
              MAX
            </button>
          </div>

          <button
            type="button"
            onClick={() => deposit.deposit(amount)}
            disabled={!amount || !isIdleLike(deposit.step)}
            className="mt-3 w-full rounded-lg bg-[#EAE4D8] px-3 py-2 text-[10px] tracking-[0.16em] text-black hover:bg-white disabled:bg-white/10 disabled:text-white/30"
          >
            {deposit.step === 'checking'
              ? 'CHECKING…'
              : deposit.step === 'approving'
                ? 'APPROVING…'
                : deposit.step === 'depositing'
                  ? 'DEPOSITING…'
                  : deposit.step === 'confirming'
                    ? 'CONFIRMING…'
                    : wallet.mode === 'passkey'
                      ? 'DEPOSIT WITH PASSKEY'
                      : 'APPROVE & DEPOSIT'}
          </button>

          {deposit.error && (
            <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              {deposit.error}
            </div>
          )}

          {error && (
            <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              {error}
            </div>
          )}

          {deposit.step === 'success' && (
            <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
              Deposit confirmed. You can unlock x402 now.
            </div>
          )}
        </div>
      )}

      <div className="mt-2 text-[10px] leading-relaxed text-white/30">
        Same wallet and Gateway balance are used for x402 unlocks.
      </div>
    </div>
  );
}
