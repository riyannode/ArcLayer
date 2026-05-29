'use client';

import { useCallback, useEffect, useState } from 'react';

interface FaucetStatus {
  ready: boolean;
  reason?: string;
  treasury?: string;
  treasuryBalanceUsdc?: string;
  claimAmountUsdc?: string;
  circleFaucetUrl?: string;
}

interface FaucetHelperProps {
  /** Connected wallet address */
  address: string;
  /** Current wallet USDC balance (formatted string, e.g. "0.00") */
  balance: string | null;
  /** Called after a successful claim so parent can refresh balance */
  onClaimed?: () => void;
  /** Compact mode for ticketOnly variant */
  compact?: boolean;
}

type ClaimState = 'idle' | 'claiming' | 'success' | 'error';

/**
 * FaucetHelper — shows "Need test USDC?" card when wallet balance is low.
 *
 * Standalone component. Does NOT modify X402DemoPanel internals.
 * Render inside the ticket sidebar between status info and action buttons.
 */
export default function FaucetHelper({ address, balance, onClaimed, compact = false }: FaucetHelperProps) {
  const [faucetStatus, setFaucetStatus] = useState<FaucetStatus | null>(null);
  const [claimState, setClaimState] = useState<ClaimState>('idle');
  const [claimError, setClaimError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const balanceNum = balance != null ? Number(balance) : null;
  const needsFaucet = balanceNum !== null && balanceNum < 0.01;

  // Fetch faucet status on mount
  useEffect(() => {
    fetch('/api/faucet/status')
      .then((r) => r.json())
      .then((data: FaucetStatus) => setFaucetStatus(data))
      .catch(() => setFaucetStatus({ ready: false, reason: 'probe_failed' }));
  }, []);

  // Countdown timer for rate limit
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const claim = useCallback(async () => {
    if (claimState === 'claiming') return;
    setClaimState('claiming');
    setClaimError('');
    setTxHash('');

    try {
      const res = await fetch('/api/faucet/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setClaimState('error');
        if (data.error === 'rate_limited_wallet') {
          setClaimError('Rate limited — try again in 2 hours.');
          setCountdown(data.retryAfterSeconds ?? 7200);
        } else if (data.error === 'treasury_empty') {
          setClaimError('Faucet treasury is empty.');
          // Refresh status
          setFaucetStatus((prev) => prev ? { ...prev, ready: false, reason: 'treasury_empty' } : null);
        } else if (data.error === 'wallet_already_funded') {
          setClaimError('Wallet already has enough USDC.');
        } else {
          setClaimError(data.error || 'Claim failed');
        }
        return;
      }

      setTxHash(data.txHash);
      setClaimState('success');
      onClaimed?.();
    } catch (e) {
      setClaimState('error');
      setClaimError(e instanceof Error ? e.message : 'Network error');
    }
  }, [address, claimState, onClaimed]);

  const copyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }, [address]);

  // Don't render if balance is sufficient or unknown
  if (!needsFaucet) return null;

  const s = compact ? 'text-[10px]' : 'text-[11px]';
  const btn = compact ? 'py-1.5 text-[10px]' : 'py-2 text-[11px]';

  // Treasury empty state — redirect to Circle Faucet
  if (faucetStatus && !faucetStatus.ready) {
    return (
      <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/[0.06] p-3 font-mono">
        <div className={`mb-1.5 ${s} text-yellow-200/90`}>ArcLayer Faucet is empty.</div>
        <div className={`mb-2.5 ${s} text-white/50`}>
          Get test USDC from the Circle Faucet instead.
        </div>
        <a
          href={faucetStatus.circleFaucetUrl || 'https://faucet.circle.com/'}
          target="_blank"
          rel="noopener noreferrer"
          className={`mb-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#7CB5C5]/30 bg-[#7CB5C5]/10 ${btn} font-mono tracking-[0.1em] text-[#7CB5C5] hover:bg-[#7CB5C5]/20`}
        >
          OPEN CIRCLE FAUCET ↗
        </a>
        <button
          onClick={copyAddress}
          className={`flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/15 ${btn} font-mono tracking-[0.1em] text-white/70 hover:bg-white/5`}
        >
          {copied ? 'COPIED ✓' : 'COPY WALLET ADDRESS'}
        </button>
      </div>
    );
  }

  // Claim success state
  if (claimState === 'success') {
    return (
      <div className="rounded-lg border border-green-400/20 bg-green-400/[0.06] p-3 font-mono">
        <div className={`mb-1 ${s} text-green-300`}>✓ {faucetStatus?.claimAmountUsdc ?? '0.05'} USDC sent</div>
        {txHash && (
          <a
            href={`https://testnet.arcscan.app/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`block break-all ${compact ? 'text-[9px]' : 'text-[10px]'} text-[#C5A67C]/80 underline underline-offset-2`}
          >
            {txHash}
          </a>
        )}
        <div className={`mt-1.5 ${compact ? 'text-[9px]' : 'text-[10px]'} text-white/40`}>
          Balance will refresh shortly. Then click BUY ACCESS.
        </div>
      </div>
    );
  }

  // Default: claim available
  return (
    <div className="rounded-lg border border-[#C5A67C]/15 bg-[#C5A67C]/[0.04] p-3 font-mono">
      <div className={`mb-1 ${s} text-white/60`}>
        Balance: <span className="text-yellow-300">{balance ?? '0'} USDC</span>
      </div>
      <div className={`mb-2.5 ${s} text-white/40`}>
        Need test USDC to unlock x402 access.
      </div>
      <button
        onClick={claim}
        disabled={claimState === 'claiming' || countdown > 0}
        className={`flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#C5A67C]/40 bg-[#C5A67C]/15 ${btn} font-mono tracking-[0.1em] text-[#C5A67C] hover:bg-[#C5A67C]/25 disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {claimState === 'claiming'
          ? 'SENDING...'
          : countdown > 0
            ? `TRY AGAIN IN ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`
            : `CLAIM ${faucetStatus?.claimAmountUsdc ?? '0.05'} TEST USDC`}
      </button>
      {claimState === 'error' && claimError && (
        <div className={`mt-2 ${compact ? 'text-[9px]' : 'text-[10px]'} text-red-300/80`}>{claimError}</div>
      )}
    </div>
  );
}
