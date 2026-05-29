'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { createPublicClient, formatUnits, getAddress, http } from 'viem';

const ARC_RPC = 'https://rpc.drpc.testnet.arc.network';
const USDC = getAddress('0x3600000000000000000000000000000000000000');
const BALANCE_ABI = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;

interface FaucetStatus {
  ready: boolean;
  reason?: string;
  treasury?: string;
  treasuryBalanceUsdc?: string;
  claimAmountUsdc?: string;
  circleFaucetUrl?: string;
}

interface FaucetHelperProps {
  compact?: boolean;
}

type ClaimState = 'idle' | 'claiming' | 'success' | 'error';

/**
 * FaucetHelper — standalone faucet card. Always visible (even before wallet connect).
 *
 * Two modes:
 *  - Wallet not connected → show "CONNECT WALLET TO CLAIM" (opens AppKit)
 *  - Wallet connected + balance < 0.01 → show claim button
 *  - Wallet connected + balance >= 0.01 → hidden (no need)
 */
export default function FaucetHelper({ compact = false }: FaucetHelperProps) {
  const { address: eoaAddress, isConnected } = useAccount();
  const { open: openAppKit } = useAppKit();
  const address = eoaAddress ?? '';

  const [balance, setBalance] = useState<string | null>(null);
  const [faucetStatus, setFaucetStatus] = useState<FaucetStatus | null>(null);
  const [claimState, setClaimState] = useState<ClaimState>('idle');
  const [claimError, setClaimError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const balanceNum = balance != null ? Number(balance) : null;
  // Hide only when wallet connected AND balance is sufficient
  const balanceOk = isConnected && balanceNum !== null && balanceNum >= 0.01;

  // Fetch wallet USDC balance when connected
  useEffect(() => {
    if (!address) { setBalance(null); return; }
    const client = createPublicClient({ transport: http(ARC_RPC) });
    client.readContract({ address: USDC, abi: BALANCE_ABI, functionName: 'balanceOf', args: [address as `0x${string}`] })
      .then((b) => setBalance(formatUnits(b, 6)))
      .catch(() => setBalance(null));
  }, [address]);

  // Fetch faucet status
  useEffect(() => {
    fetch('/api/faucet/status')
      .then((r) => r.json())
      .then((data: FaucetStatus) => setFaucetStatus(data))
      .catch(() => setFaucetStatus({ ready: false, reason: 'probe_failed' }));
  }, []);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const refreshBalance = useCallback(() => {
    if (!address) return;
    const client = createPublicClient({ transport: http(ARC_RPC) });
    client.readContract({ address: USDC, abi: BALANCE_ABI, functionName: 'balanceOf', args: [address as `0x${string}`] })
      .then((b) => setBalance(formatUnits(b, 6)))
      .catch(() => {});
  }, [address]);

  const claim = useCallback(async () => {
    if (claimState === 'claiming' || !address) return;
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
      setTimeout(refreshBalance, 2000);
    } catch (e) {
      setClaimState('error');
      setClaimError(e instanceof Error ? e.message : 'Network error');
    }
  }, [address, claimState, refreshBalance]);

  const copyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }, [address]);

  // Hidden when balance is sufficient
  if (balanceOk) return null;

  const s = compact ? 'text-[10px]' : 'text-[11px]';
  const sxs = compact ? 'text-[9px]' : 'text-[10px]';
  const btn = compact ? 'py-1.5 text-[10px]' : 'py-2 text-[11px]';
  const radius = compact ? 'rounded-xl' : 'rounded-2xl';
  const claimAmount = faucetStatus?.claimAmountUsdc ?? '0.05';

  // ─── Treasury empty → Circle Faucet fallback ───
  if (faucetStatus && !faucetStatus.ready) {
    return (
      <div className={`${radius} w-full max-w-[440px] border border-yellow-400/20 bg-[#111]/95 p-3.5 font-mono shadow-2xl shadow-black/40`}>
        <div className={`mb-1.5 ${s} text-yellow-200/90`}>ArcLayer Faucet is empty.</div>
        <div className={`mb-2.5 ${sxs} text-white/40`}>
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
        {isConnected && (
          <button
            onClick={copyAddress}
            className={`flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/15 ${btn} font-mono tracking-[0.1em] text-white/70 hover:bg-white/5`}
          >
            {copied ? 'COPIED ✓' : 'COPY WALLET ADDRESS'}
          </button>
        )}
      </div>
    );
  }

  // ─── Claim success ───
  if (claimState === 'success') {
    return (
      <div className={`${radius} w-full max-w-[440px] border border-green-400/20 bg-[#111]/95 p-3.5 font-mono shadow-2xl shadow-black/40`}>
        <div className={`mb-1 ${s} text-green-300`}>✓ {claimAmount} USDC sent</div>
        {txHash && (
          <a
            href={`https://testnet.arcscan.app/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`block break-all ${sxs} text-[#C5A67C]/80 underline underline-offset-2`}
          >
            {txHash}
          </a>
        )}
        <div className={`mt-1.5 ${sxs} text-white/40`}>
          Balance refreshing… then click BUY ACCESS above.
        </div>
      </div>
    );
  }

  // ─── Wallet not connected → show connect CTA ───
  if (!isConnected) {
    return (
      <div className={`${radius} w-full max-w-[440px] border border-[#C5A67C]/15 bg-[#111]/95 p-3.5 font-mono shadow-2xl shadow-black/40`}>
        <div className={`mb-1 ${s} text-white/80`}>
          Need test USDC?
        </div>
        <div className={`mb-2.5 ${sxs} text-white/40`}>
          Connect wallet to claim {claimAmount} free test USDC for x402 access.
        </div>
        <button
          onClick={() => openAppKit()}
          className={`flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-white/[0.06] ${btn} font-mono tracking-[0.1em] text-white hover:bg-white/[0.12]`}
        >
          CONNECT WALLET TO CLAIM
        </button>
      </div>
    );
  }

  // ─── Wallet connected + balance low → claim button ───
  return (
    <div className={`${radius} w-full max-w-[440px] border border-[#C5A67C]/15 bg-[#111]/95 p-3.5 font-mono shadow-2xl shadow-black/40`}>
      <div className={`mb-1 ${s} text-white/60`}>
        Balance: <span className="text-yellow-300">{balance ?? '0'} USDC</span>
      </div>
      <div className={`mb-2.5 ${sxs} text-white/40`}>
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
            : `CLAIM ${claimAmount} TEST USDC`}
      </button>
      {claimState === 'error' && claimError && (
        <div className={`mt-2 ${sxs} text-red-300/80`}>{claimError}</div>
      )}
    </div>
  );
}
