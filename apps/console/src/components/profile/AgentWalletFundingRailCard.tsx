'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, Clipboard, Loader2, Plus, RefreshCcw } from 'lucide-react';
import { useSignMessage } from 'wagmi';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useCircleWallet } from '@/hooks/useCircleWallet';
import { useFundAgentAccount } from '@/hooks/useFundAgentAccount';
import { useAgentAccountGatewayDeposit } from '@/hooks/useAgentAccountGatewayDeposit';

type BalanceInfo = {
  raw: string;
  formatted: string;
};

type AgentAccountInfo = {
  ok?: boolean;
  disabled?: boolean;
  ownerAddress: string | null;
  agentAccountAddress: string | null;
  status: string;
  chainId: number;
  walletProvider?: string;
  accountType?: string;
  error?: string;
};

type ProfileBalancesResponse = {
  ok: boolean;
  owner: {
    address: string;
    usdc: BalanceInfo;
    gateway?: BalanceInfo | null;
  };
  agentAccount: {
    address: string;
    usdc: BalanceInfo | null;
    gateway: BalanceInfo | null;
  } | null;
  network: string;
  chainId: number;
  error?: string;
};

const ARC_EXPLORER_TX_BASE = 'https://testnet.arcscan.app/tx';

function getArcTxUrl(hash: string): string {
  return `${ARC_EXPLORER_TX_BASE}/${hash}`;
}

function shortAddress(value?: string | null): string {
  if (!value) return '—';
  if (value.length < 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function copyToClipboard(value?: string | null) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
}

export function AgentWalletFundingRailCard() {
  const { isConnected, address, ready } = useArcWallet();
  const { signMessageAsync } = useSignMessage();
  const {
    authenticated: circleAuthenticated,
    login: circleLogin,
    address: circleAddress,
    bundlerClient,
  } = useCircleWallet();

  const [agentAccount, setAgentAccount] = useState<AgentAccountInfo | null>(null);
  const [agentAccountLoading, setAgentAccountLoading] = useState(false);
  const [agentAccountError, setAgentAccountError] = useState<string | null>(null);

  const [ownerUsdcBalance, setOwnerUsdcBalance] = useState<BalanceInfo | null>(null);
  const [agentUsdcBalance, setAgentUsdcBalance] = useState<BalanceInfo | null>(null);
  const [agentGatewayBalance, setAgentGatewayBalance] = useState<BalanceInfo | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);

  const [fundAmount, setFundAmount] = useState('');
  const [gatewayAmount, setGatewayAmount] = useState('');

  const agentAccountAddress = agentAccount?.agentAccountAddress ?? null;
  const hasAgentAccount = Boolean(agentAccountAddress);

  const refreshProfileBalances = useCallback(
    async (ownerAddress: string, agentWalletAddress?: string | null) => {
      if (!ownerAddress) return;

      setBalancesLoading(true);
      setBalancesError(null);

      try {
        const params = new URLSearchParams();
        params.set('owner', ownerAddress);
        if (agentWalletAddress) {
          params.set('agentAccount', agentWalletAddress);
        }

        const res = await fetch(`/api/profile/balances?${params.toString()}`, {
          cache: 'no-store',
        });

        const json = (await res.json()) as ProfileBalancesResponse;
if (!res.ok || !json.ok) {
          throw new Error(json.error || 'Failed to load Agent Wallet balances.');
        }

        setOwnerUsdcBalance(json.owner?.usdc ?? null);
        setAgentUsdcBalance(json.agentAccount?.usdc ?? null);
        setAgentGatewayBalance(json.agentAccount?.gateway ?? null);
      } catch (error) {
        setBalancesError(error instanceof Error ? error.message : String(error));
        setOwnerUsdcBalance((prev) => prev ?? { raw: '0', formatted: '0.000000' });
        setAgentUsdcBalance((prev) => prev ?? { raw: '0', formatted: '0.000000' });
        setAgentGatewayBalance((prev) => prev ?? { raw: '0', formatted: '0.000000' });
      } finally {
        setBalancesLoading(false);
      }
    },
    [],
  );

  const loadAgentAccount = useCallback(
    async (ensureSession = false) => {
      if (!address) return;

      setAgentAccountLoading(true);
      setAgentAccountError(null);

      try {
        let res = await fetch('/api/profile/agent-account', { cache: 'no-store' });

        if (res.status === 401 && ensureSession) {
          const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession');
          const sessionResult = await ensureWalletSession(address, signMessageAsync);

          if (!sessionResult.ok) {
            throw new Error(sessionResult.error);
          }

          res = await fetch('/api/profile/agent-account', { cache: 'no-store' });
        }

        if (res.status === 401) {
          setAgentAccount(null);
          setAgentAccountError('Sign once to load your Agent Wallet.');
          return;
        }

        const json = (await res.json()) as AgentAccountInfo;

        if (!res.ok || json.ok === false) {
          throw new Error(json.error || 'Failed to load Agent Wallet.');
        }

        setAgentAccount(json);

        if (json.agentAccountAddress) {
          await refreshProfileBalances(address, json.agentAccountAddress);
        } else {
          await refreshProfileBalances(address, null);
        }
      } catch (error) {
        setAgentAccount(null);
        setAgentAccountError(error instanceof Error ? error.message : String(error));
      } finally {
        setAgentAccountLoading(false);
      }
    },
    [address, refreshProfileBalances, signMessageAsync],
  );

  const fundAgentAccount = useFundAgentAccount(() => {
    if (address && agentAccountAddress) {
      void refreshProfileBalances(address, agentAccountAddress);
    }
    setFundAmount('');
  });

  const agentGatewayDeposit = useAgentAccountGatewayDeposit(bundlerClient, () => {
    if (address && agentAccountAddress) {
      void refreshProfileBalances(address, agentAccountAddress);
    }
    setGatewayAmount('');
  });

  useEffect(() => {
    if (!ready || !isConnected || !address) {
      setAgentAccount(null);
      setOwnerUsdcBalance(null);
      setAgentUsdcBalance(null);
      setAgentGatewayBalance(null);
      return;
    }

    void loadAgentAccount(false);
  }, [ready, isConnected, address, loadAgentAccount]);

  async function handleAgentGatewayDeposit() {
    if (!agentAccountAddress) return;

    if (!circleAuthenticated) {
      await circleLogin();
      return;
    }

    await agentGatewayDeposit.deposit(gatewayAmount, agentAccountAddress);
  }

  if (!ready || !isConnected || !address) {
    return null;
  }
return (
    <div className="mt-8 grid gap-5 lg:grid-cols-2">
      <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-5 py-4 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
        <div className="flex items-center justify-between gap-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
            Account Overview
          </div>
          <button
            type="button"
            onClick={() => void loadAgentAccount(true)}
            disabled={agentAccountLoading}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-[11px] text-[#EAE4D8]/55 transition hover:border-[#F3C536]/35 hover:text-[#F3C536] disabled:opacity-40"
          >
            {agentAccountLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            Load
          </button>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-2.5">
          <div className="text-[13px] text-[#EAE4D8]/60">Owner / Funding EOA</div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[13px] text-[#F5F0E5]">
              {shortAddress(address)}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(address)}
              className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]"
              aria-label="Copy owner EOA address"
            >
              <Clipboard className="h-3.5 w-3.5" />
            </button>
            <span className="ml-auto rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
              Connected
            </span>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-2.5">
          <div className="text-[13px] text-[#EAE4D8]/60">Circle Agent Wallet</div>
          <div className="flex min-w-0 items-center gap-2">
            {hasAgentAccount ? (
              <>
                <span className="truncate font-mono text-[13px] text-[#F5F0E5]">
                  {shortAddress(agentAccountAddress)}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(agentAccountAddress)}
                  className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]"
                  aria-label="Copy Agent Wallet address"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
                <span className="ml-auto rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                  Active
                </span>
              </>
            ) : (
              <span className="text-[13px] text-[#EAE4D8]/40">
                No Agent Wallet linked
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_1fr] items-center gap-3 py-2.5">
          <div className="text-[13px] text-[#EAE4D8]/60">Wallet Role</div>
          <div className="text-[13px] text-[#F5F0E5]">
            EOA funds · Agent Wallet operates
          </div>
        </div>

        <p className="mt-1 text-[11px] leading-5 text-[#EAE4D8]/35">
          EOA is used for ownership and funding. Circle Agent Wallet is the agent funding and future runtime wallet.
        </p>

        {agentAccountError && (
          <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] leading-5 text-amber-200/80">
            {agentAccountError}
          </p>
        )}
<div className="mt-3 flex flex-wrap gap-3">
          <Link
            href="/register/erc8004"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#F3C536]/40 bg-transparent px-4 text-[12px] font-medium text-[#F3C536] transition hover:bg-[#F3C536]/10"
          >
            <Plus className="h-4 w-4" /> Register ERC-8004 Agent
          </Link>
          <Link
            href="/agent-setup"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#F3C536]/40 bg-transparent px-4 text-[12px] font-medium text-[#F3C536] transition hover:bg-[#F3C536]/10"
          >
            <Bot className="h-4 w-4" /> Open Agent Setup
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-5 py-4 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
          Circle Agent Wallet Funding
        </div>

        <p className="mt-2 rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-3 py-1.5 text-[11px] leading-5 text-[#F3C536]/80">
          Fund the Agent Wallet from your EOA, then deposit from Agent Wallet into Gateway.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-white/10 bg-white/[0.025] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
              Owner EOA USDC
            </div>
            <div className="mt-2 text-[18px] font-semibold text-[#F5F0E5]">
              {balancesLoading ? '...' : ownerUsdcBalance?.formatted ?? '0.000000'}
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/[0.025] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
              Agent Wallet USDC
            </div>
            <div className="mt-2 text-[18px] font-semibold text-[#F5F0E5]">
              {balancesLoading ? '...' : agentUsdcBalance?.formatted ?? '0.000000'}
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/[0.025] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
              Agent Gateway
            </div>
            <div className="mt-2 text-[18px] font-semibold text-[#F3C536]">
              {balancesLoading ? '...' : agentGatewayBalance?.formatted ?? '0.000000'}
            </div>
          </div>
        </div>
<div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <label className="text-[11px] uppercase tracking-[0.14em] text-[#EAE4D8]/38">
              Fund Agent Wallet (USDC)
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                inputMode="decimal"
                placeholder="1.00"
                value={fundAmount}
                onChange={(event) => {
                  setFundAmount(event.target.value);
                  fundAgentAccount.reset();
                }}
                className="h-10 w-full rounded-md border border-white/10 bg-[#05070A] px-3 font-mono text-[13px] text-[#F5F0E5] placeholder-[#EAE4D8]/30 outline-none focus:border-[#F3C536]/40"
              />
              <button
                type="button"
                onClick={() => {
                  if (agentAccountAddress) {
                    void fundAgentAccount.fund(fundAmount, agentAccountAddress);
                  }
                }}
                disabled={
                  !fundAmount ||
                  !agentAccountAddress ||
                  (fundAgentAccount.step !== 'idle' && fundAgentAccount.step !== 'error')
                }
                className="h-10 shrink-0 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:opacity-40"
              >
                {fundAgentAccount.step === 'checking' ||
                fundAgentAccount.step === 'transferring' ||
                fundAgentAccount.step === 'confirming'
                  ? 'Funding...'
                  : 'Fund Wallet'}
              </button>
            </div>

            <div className="mt-2 text-[11px] leading-5 text-[#EAE4D8]/40">
              Status: <span className="font-mono text-[#EAE4D8]/70">{fundAgentAccount.step}</span>
            </div>

            {fundAgentAccount.txHash && (
              <p className="mt-2 text-[11px] text-emerald-400">
                Fund tx ✓{' '}
                <a
                  href={getArcTxUrl(fundAgentAccount.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-emerald-400/40 hover:text-emerald-300"
                >
                  {shortAddress(fundAgentAccount.txHash)}
                </a>
              </p>
            )}

            {fundAgentAccount.error && (
              <p className="mt-2 text-[11px] text-red-400">{fundAgentAccount.error}</p>
            )}
          </div>
<div>
            <label className="text-[11px] uppercase tracking-[0.14em] text-[#EAE4D8]/38">
              Deposit Agent Wallet → Gateway (USDC)
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                inputMode="decimal"
                placeholder="1.00"
                value={gatewayAmount}
                onChange={(event) => {
                  setGatewayAmount(event.target.value);
                  agentGatewayDeposit.reset();
                }}
                className="h-10 w-full rounded-md border border-white/10 bg-[#05070A] px-3 font-mono text-[13px] text-[#F5F0E5] placeholder-[#EAE4D8]/30 outline-none focus:border-[#F3C536]/40"
              />
              <button
                type="button"
                onClick={() => void handleAgentGatewayDeposit()}
                disabled={
                  !gatewayAmount ||
                  !agentAccountAddress ||
                  (agentGatewayDeposit.step !== 'idle' && agentGatewayDeposit.step !== 'error')
                }
                className="h-10 shrink-0 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:opacity-40"
              >
                {!circleAuthenticated
                  ? 'Login & Deposit'
                  : agentGatewayDeposit.step === 'checking' ||
                      agentGatewayDeposit.step === 'depositing' ||
                      agentGatewayDeposit.step === 'confirming'
                    ? 'Depositing...'
                    : 'Deposit Gateway'}
              </button>
            </div>

            <div className="mt-2 text-[11px] leading-5 text-[#EAE4D8]/40">
              Status: <span className="font-mono text-[#EAE4D8]/70">{agentGatewayDeposit.step}</span>
            </div>

            {circleAddress && agentAccountAddress && (
              <p className="mt-1 text-[10px] text-[#EAE4D8]/30">
                Circle: {shortAddress(circleAddress)} · Agent Wallet: {shortAddress(agentAccountAddress)}
              </p>
            )}

            {agentGatewayDeposit.userOpHash && (
              <p className="mt-2 text-[11px] text-[#EAE4D8]/50">
                UserOp: <span className="font-mono">{shortAddress(agentGatewayDeposit.userOpHash)}</span>
              </p>
            )}

            {agentGatewayDeposit.txHash && (
              <p className="mt-2 text-[11px] text-emerald-400">
                Gateway deposit tx ✓{' '}
                <a
                  href={getArcTxUrl(agentGatewayDeposit.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-emerald-400/40 hover:text-emerald-300"
                >
                  {shortAddress(agentGatewayDeposit.txHash)}
                </a>
              </p>
            )}

            {agentGatewayDeposit.error && (
              <p className="mt-2 text-[11px] text-red-400">{agentGatewayDeposit.error}</p>
            )}
          </div>
        </div>

        {balancesError && (
          <p className="mt-3 text-[11px] text-red-400">{balancesError}</p>
        )}
      </div>
    </div>
  );
}
