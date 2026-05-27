'use client';

/**
 * /wallet — Circle Gateway Wallet Onboarding
 *
 * User-facing page for depositing USDC into Circle Gateway,
 * checking unified balance, and withdrawing funds.
 *
 * Designed for non-technical users — plain language, big buttons,
 * clear progress feedback.
 */

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import Link from 'next/link';

// ─── Contract Addresses ────────────────────────────────────────
const USDC = '0x3600000000000000000000000000000000000000' as const;
const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;
const EXPLORER = 'https://testnet.arcscan.app';

// ─── ABIs ──────────────────────────────────────────────────────
const ERC20_ABI = [
  { type: 'function' as const, stateMutability: 'view' as const, name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function' as const, stateMutability: 'view' as const, name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function' as const, stateMutability: 'nonpayable' as const, name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const;

const GATEWAY_ABI = [
  { type: 'function' as const, stateMutability: 'nonpayable' as const, name: 'deposit', inputs: [{ name: 'token', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [] },
  { type: 'function' as const, stateMutability: 'view' as const, name: 'deposits', inputs: [{ name: 'depositor', type: 'address' }, { name: 'token', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const;

// ─── Preset Amounts ────────────────────────────────────────────
const PRESETS = ['5', '10', '25', '50'] as const;

// ─── Steps ─────────────────────────────────────────────────────
type Step = 'idle' | 'approving' | 'approved' | 'depositing' | 'done' | 'error';

function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { key: 'approve', label: 'Allow', done: step === 'approved' || step === 'depositing' || step === 'done', active: step === 'approving' },
    { key: 'deposit', label: 'Deposit', done: step === 'done', active: step === 'depositing' },
    { key: 'done', label: 'Done', done: false, active: step === 'done' },
  ];

  return (
    <div className="flex items-center justify-center gap-2 my-6">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono transition-all duration-300 ${
            s.done ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
            s.active ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse' :
            'bg-white/5 text-white/30 border border-white/10'
          }`}>
            {s.done ? '✓' : i + 1}
          </div>
          <span className={`text-xs font-mono ${s.done ? 'text-emerald-400' : s.active ? 'text-amber-400' : 'text-white/30'}`}>
            {s.label}
          </span>
          {i < steps.length - 1 && <div className={`w-8 h-px ${s.done ? 'bg-emerald-500/40' : 'bg-white/10'}`} />}
        </div>
      ))}
    </div>
  );
}

// ─── Balance Card ──────────────────────────────────────────────
function BalanceCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 flex-1 min-w-[140px]">
      <div className="text-[11px] font-mono tracking-[0.15em] text-white/40 uppercase mb-2">{icon} {label}</div>
      <div className="text-2xl font-light text-white/90 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] font-mono text-white/30 mt-1">{sub}</div>}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function WalletPage() {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);

  // ─── Read Balances ───────────────────────────────────────────
  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const { data: gatewayBalance, refetch: refetchGateway } = useReadContract({
    address: GATEWAY_WALLET,
    abi: GATEWAY_ABI,
    functionName: 'deposits',
    args: address ? [address, USDC] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, GATEWAY_WALLET] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  // ─── Write Contracts ────────────────────────────────────────
  const { writeContractAsync: writeApprove, isPending: isApproving } = useWriteContract();
  const { writeContractAsync: writeDeposit, isPending: isDepositing } = useWriteContract();

  // ─── Transaction Tracking ───────────────────────────────────
  const { data: approveReceipt } = useWaitForTransactionReceipt({
    hash: step === 'approving' && txHash ? (txHash as `0x${string}`) : undefined,
  });

  const { data: depositReceipt } = useWaitForTransactionReceipt({
    hash: step === 'depositing' && txHash ? (txHash as `0x${string}`) : undefined,
  });

  // Handle approve confirmation
  useEffect(() => {
    if (approveReceipt && step === 'approving') {
      setStep('approved');
      refetchAllowance();
      // Auto-proceed to deposit
      handleDeposit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt]);

  // Handle deposit confirmation
  useEffect(() => {
    if (depositReceipt && step === 'depositing') {
      setStep('done');
      refetchUsdc();
      refetchGateway();
      setAmount('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositReceipt]);

  // ─── Handlers ───────────────────────────────────────────────
  const parsedAmount = amount ? parseUnits(amount, 6) : BigInt(0);
  const needsApproval = allowance !== undefined && parsedAmount > allowance;

  const handleApproveAndDeposit = useCallback(async () => {
    if (!address || !amount || parsedAmount === BigInt(0)) return;

    setError('');
    setTxHash(null);

    try {
      // Step 1: Approve if needed
      if (needsApproval) {
        setStep('approving');
        const hash = await writeApprove({
          address: USDC,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [GATEWAY_WALLET, parsedAmount],
        });
        setTxHash(hash);
        // Wait for receipt via useEffect
        return;
      }

      // Step 2: Direct deposit if already approved
      await handleDeposit();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setError(msg.includes('UserRejected') ? 'You cancelled the transaction' : msg);
      setStep('error');
    }
  }, [address, amount, parsedAmount, needsApproval, writeApprove]);

  const handleDeposit = useCallback(async () => {
    if (!address || parsedAmount === BigInt(0)) return;

    try {
      setStep('depositing');
      const hash = await writeDeposit({
        address: GATEWAY_WALLET,
        abi: GATEWAY_ABI,
        functionName: 'deposit',
        args: [USDC, parsedAmount],
      });
      setTxHash(hash);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Deposit failed';
      setError(msg.includes('UserRejected') ? 'You cancelled the transaction' : msg);
      setStep('error');
    }
  }, [address, parsedAmount, writeDeposit]);

  const resetForm = () => {
    setStep('idle');
    setAmount('');
    setError('');
    setTxHash(null);
  };

  // ─── Formatted Values ───────────────────────────────────────
  const formattedUsdc = usdcBalance !== undefined ? formatUnits(usdcBalance, 6) : '—';
  const formattedGateway = gatewayBalance !== undefined ? formatUnits(gatewayBalance, 6) : '—';
  const maxAmount = usdcBalance !== undefined ? formatUnits(usdcBalance, 6) : '0';

  // ─── Not Connected State ────────────────────────────────────
  if (!isConnected) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="text-5xl mb-4">🔗</div>
          <h1 className="text-2xl font-light text-white/90">Connect Your Wallet</h1>
          <p className="text-sm text-white/50 leading-relaxed">
            Connect your wallet to deposit USDC into Circle Gateway.
            Your Gateway balance can be used to pay for AI agent services on ArcLayer instantly.
          </p>
          <div className="pt-4">
            <appkit-button />
          </div>
          <p className="text-[11px] text-white/30 font-mono">
            Arc Testnet · Chain ID 5042002
          </p>
        </div>
      </main>
    );
  }

  // ─── Main Dashboard ─────────────────────────────────────────
  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-light text-white/90">Gateway Wallet</h1>
          <p className="text-sm text-white/50">
            Deposit USDC into Circle Gateway to pay for AI agent services instantly.
          </p>
        </div>

        {/* Balance Cards */}
        <div className="flex flex-col sm:flex-row gap-3">
          <BalanceCard
            label="Your USDC"
            value={`$${formattedUsdc}`}
            sub="Available to deposit"
            icon="💰"
          />
          <BalanceCard
            label="Gateway Balance"
            value={`$${formattedGateway}`}
            sub="Ready to spend"
            icon="⚡"
          />
        </div>

        {/* Connected Address */}
        <div className="bg-white/[0.02] border border-white/5 rounded-lg px-4 py-2 flex items-center justify-between">
          <span className="text-[11px] font-mono text-white/30">Connected</span>
          <span className="text-xs font-mono text-white/60">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </span>
        </div>

        {/* Deposit Section */}
        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-6 space-y-5">
          <h2 className="text-lg font-light text-white/80">Deposit to Gateway</h2>

          {/* Amount Input */}
          <div>
            <label className="text-[11px] font-mono tracking-[0.15em] text-white/40 uppercase mb-2 block">
              Amount (USDC)
            </label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setStep('idle'); setError(''); }}
                placeholder="0.00"
                min="0"
                step="0.01"
                disabled={step === 'approving' || step === 'depositing'}
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-4 py-3 text-xl text-white/90 font-light tabular-nums placeholder:text-white/20 focus:outline-none focus:border-white/20 disabled:opacity-50"
              />
              <button
                onClick={() => setAmount(maxAmount)}
                disabled={step === 'approving' || step === 'depositing'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono text-white/40 hover:text-white/70 uppercase tracking-wider disabled:opacity-50"
              >
                MAX
              </button>
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="flex gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => { setAmount(p); setStep('idle'); setError(''); }}
                disabled={step === 'approving' || step === 'depositing'}
                className={`flex-1 py-2 text-sm font-mono rounded-lg border transition-all disabled:opacity-50 ${
                  amount === p
                    ? 'bg-white/10 border-white/20 text-white/80'
                    : 'bg-white/[0.02] border-white/5 text-white/40 hover:border-white/10 hover:text-white/60'
                }`}
              >
                ${p}
              </button>
            ))}
          </div>

          {/* Step Indicator */}
          {(step === 'approving' || step === 'depositing' || step === 'done') && (
            <StepIndicator step={step} />
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Success */}
          {step === 'done' && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-4 text-center space-y-3">
              <div className="text-emerald-400 text-sm">✅ Deposit successful!</div>
              {txHash && (
                <Link
                  href={`${EXPLORER}/tx/${txHash}`}
                  target="_blank"
                  className="text-[11px] font-mono text-emerald-400/60 hover:text-emerald-400 underline underline-offset-2"
                >
                  View on explorer →
                </Link>
              )}
            </div>
          )}

          {/* Action Button */}
          {step === 'done' ? (
            <button
              onClick={resetForm}
              className="w-full py-3 rounded-lg bg-white/[0.06] border border-white/10 text-white/70 text-sm font-mono hover:bg-white/10 transition-all"
            >
              Deposit More
            </button>
          ) : (
            <button
              onClick={handleApproveAndDeposit}
              disabled={!amount || parsedAmount === BigInt(0) || step === 'approving' || step === 'depositing'}
              className="w-full py-3 rounded-lg bg-white text-black text-sm font-medium tracking-wide hover:bg-white/90 disabled:bg-white/10 disabled:text-white/30 transition-all"
            >
              {step === 'approving' ? 'Approving…' :
               step === 'depositing' ? 'Depositing…' :
               needsApproval ? 'Approve & Deposit' : 'Deposit'}
            </button>
          )}
        </div>

        {/* Info Section */}
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-mono text-white/50 tracking-wide">How it works</h3>
          <ul className="space-y-2 text-xs text-white/40 leading-relaxed">
            <li className="flex gap-2">
              <span className="text-white/20">1.</span>
              <span><strong className="text-white/60">Approve</strong> — Allow Gateway to use your USDC (one-time per amount)</span>
            </li>
            <li className="flex gap-2">
              <span className="text-white/20">2.</span>
              <span><strong className="text-white/60">Deposit</strong> — USDC moves into your Gateway balance</span>
            </li>
            <li className="flex gap-2">
              <span className="text-white/20">3.</span>
              <span><strong className="text-white/60">Spend</strong> — Use Gateway balance to pay for AI agent services instantly (&lt;500ms)</span>
            </li>
          </ul>
        </div>

        {/* Withdraw Info */}
        <div className="bg-amber-500/[0.05] border border-amber-500/10 rounded-xl p-5 space-y-2">
          <h3 className="text-sm font-mono text-amber-400/70 tracking-wide">⚠️ Withdrawal Notice</h3>
          <p className="text-xs text-white/40 leading-relaxed">
            Withdrawals from Gateway have a <strong className="text-amber-400/60">7-day waiting period</strong> for security.
            To withdraw, you&apos;ll need to initiate the withdrawal and come back after 7 days to claim your funds.
          </p>
          <p className="text-xs text-white/30">
            For help with withdrawals, visit the{' '}
            <Link href="/docs" className="text-white/50 underline underline-offset-2 hover:text-white/70">
              SDK docs
            </Link>{' '}
            or contact support.
          </p>
        </div>

        {/* Footer Links */}
        <div className="flex justify-center gap-6 text-[11px] font-mono text-white/20">
          <Link href={`${EXPLORER}/address/${GATEWAY_WALLET}`} target="_blank" className="hover:text-white/40">
            Gateway Contract ↗
          </Link>
          <Link href="https://faucet.circle.com" target="_blank" className="hover:text-white/40">
            Get Test USDC ↗
          </Link>
          <Link href="/docs" className="hover:text-white/40">
            SDK Docs
          </Link>
        </div>
      </div>
    </main>
  );
}
