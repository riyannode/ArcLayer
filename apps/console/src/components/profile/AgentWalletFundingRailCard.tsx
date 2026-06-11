'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clipboard, Loader2, RefreshCcw } from 'lucide-react';
import { useSignMessage } from 'wagmi';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useCircleWallet } from '@/hooks/useCircleWallet';
import { useFundAgentAccount } from '@/hooks/useFundAgentAccount';
import { useAgentAccountGatewayDeposit } from '@/hooks/useAgentAccountGatewayDeposit';
import { getExplorerTxUrl } from '@/lib/contracts';

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
  };
  agentAccount: {
    address: string;
    usdc: BalanceInfo | null;
    gateway: BalanceInfo | null;
  } | null;
  error?: string;
};

function shortAddress(value?: string | null): string {
  if (!value) return '—';
  if (value.length < 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function copyToClipboard(value?: string | null) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.toLowerCase();
  if (message.includes('cancel') || message.includes('abort') || message.includes('notallowed')) {
    return 'Passkey request was cancelled.';
  }
  return error.message || fallback;
}

export function AgentWalletFundingRailCard() {
  const { isConnected, address, ready } = useArcWallet();
  const { signMessageAsync } = useSignMessage();
  const {
    authenticated: circleAuthenticated,
    login: circleLogin,
    register: circleRegister,
    address: circleAddress,
    bundlerClient,
  } = useCircleWallet();

  const [agentAccount, setAgentAccount] = useState<AgentAccountInfo | null>(null);
  const [agentAccountLoading, setAgentAccountLoading] = useState(false);
  const [agentAccountError, setAgentAccountError] = useState<string | null>(null);
  const [creatingAgentWallet, setCreatingAgentWallet] = useState(false);
  const [showPasskeyRegistration, setShowPasskeyRegistration] = useState(false);
  const [passkeyUsername, setPasskeyUsername] = useState('');

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
      setBalancesLoading(true);
      setBalancesError(null);

      try {
        const params = new URLSearchParams({ owner: ownerAddress });
        if (agentWalletAddress) params.set('agentAccount', agentWalletAddress);

        const response = await fetch(`/api/profile/balances?${params.toString()}`, {
          cache: 'no-store',
        });
        const json = (await response.json()) as ProfileBalancesResponse;

        if (!response.ok || !json.ok) {
          throw new Error(json.error || 'Failed to load Agent Wallet balances.');
        }

        setOwnerUsdcBalance(json.owner.usdc);
        setAgentUsdcBalance(json.agentAccount?.usdc ?? null);
        setAgentGatewayBalance(json.agentAccount?.gateway ?? null);
      } catch (error) {
        setBalancesError(errorMessage(error, 'Failed to load Agent Wallet balances.'));
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
        let response = await fetch('/api/profile/agent-account', { cache: 'no-store' });

        if (response.status === 401 && ensureSession) {
          const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession');
          const session = await ensureWalletSession(address, signMessageAsync);
          if (!session.ok) throw new Error(session.error);
          response = await fetch('/api/profile/agent-account', { cache: 'no-store' });
        }

        if (response.status === 401) {
          setAgentAccount(null);
          setAgentAccountError('Sign once to load or create your Agent Wallet.');
          await refreshProfileBalances(address, null);
          return;
        }

        const json = (await response.json()) as AgentAccountInfo;
        if (!response.ok || json.ok === false) {
          throw new Error(json.error || 'Failed to load Agent Wallet.');
        }

        setAgentAccount(json);
        await refreshProfileBalances(address, json.agentAccountAddress);
      } catch (error) {
        setAgentAccount(null);
        setAgentAccountError(errorMessage(error, 'Failed to load Agent Wallet.'));
      } finally {
        setAgentAccountLoading(false);
      }
    },
    [address, refreshProfileBalances, signMessageAsync],
  );

  const linkAgentWallet = useCallback(
    async (agentWalletAddress: string): Promise<AgentAccountInfo> => {
      if (!address) throw new Error('Connect your owner wallet first.');

      const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession');
      const session = await ensureWalletSession(address, signMessageAsync);
      if (!session.ok) throw new Error(session.error);

      const response = await fetch('/api/profile/agent-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentAccountAddress: agentWalletAddress }),
      });
      const json = (await response.json()) as AgentAccountInfo;

      if (!response.ok || json.ok === false) {
        throw new Error(json.error || 'Failed to link Agent Wallet.');
      }

      setAgentAccount(json);
      setAgentAccountError(null);
      await refreshProfileBalances(address, json.agentAccountAddress);
      return json;
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

  async function handleCreateAgentWallet() {
    setCreatingAgentWallet(true);
    setAgentAccountError(null);

    try {
      await linkCurrentCircleWallet();
    } catch (error) {
      setAgentAccountError(errorMessage(error, 'Failed to create or link Agent Wallet.'));
    } finally {
      setCreatingAgentWallet(false);
    }
  }

  async function linkCurrentCircleWallet(): Promise<AgentAccountInfo> {
    if (!address) {
      throw new Error('Connect your admin wallet first.');
    }

    let agentWalletAddress = circleAuthenticated && circleAddress ? circleAddress : '';

    if (!agentWalletAddress) {
      agentWalletAddress = await circleLogin();
    }

    if (!agentWalletAddress) {
      throw new Error('Circle Agent Wallet login failed.');
    }

    return await linkAgentWallet(agentWalletAddress);
  }

  async function handlePasskeyRegistration() {
    const username = passkeyUsername.trim();
    if (!username) return;

    setCreatingAgentWallet(true);
    setAgentAccountError(null);

    try {
      const agentWalletAddress = await circleRegister(username);
      await linkAgentWallet(agentWalletAddress);
      setPasskeyUsername('');
      setShowPasskeyRegistration(false);
    } catch (error) {
      setAgentAccountError(errorMessage(error, 'Passkey registration failed.'));
    } finally {
      setCreatingAgentWallet(false);
    }
  }

  async function handleGatewayAction() {
    if (!agentAccountAddress) return;

    if (!circleAuthenticated) {
      try {
        await circleLogin();
      } catch (error) {
        setAgentAccountError(errorMessage(error, 'Circle login failed.'));
      }
      return;
    }

    await agentGatewayDeposit.deposit(gatewayAmount, agentAccountAddress);
  }

  if (!ready || !isConnected || !address) return null;

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-2">
      <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
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

        <div className="mt-4 grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-3">
          <div className="text-[13px] text-[#EAE4D8]/60">Owner Wallet</div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-[13px] text-[#F5F0E5]">{shortAddress(address)}</span>
            <button type="button" onClick={() => copyToClipboard(address)} className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]" aria-label="Copy owner wallet address">
              <Clipboard className="h-3.5 w-3.5" />
            </button>
            <span className="ml-auto rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
              Connected
            </span>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-3">
          <div className="text-[13px] text-[#EAE4D8]/60">Agent Wallet</div>
          <div className="flex min-w-0 items-center gap-2">
            {hasAgentAccount ? (
              <>
                <span className="truncate font-mono text-[13px] text-[#F5F0E5]">{shortAddress(agentAccountAddress)}</span>
                <button type="button" onClick={() => copyToClipboard(agentAccountAddress)} className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]" aria-label="Copy Agent Wallet address">
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
                <span className="ml-auto rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-2 py-0.5 font-mono text-[10px] text-[#F3C536]">
                  Active
                </span>
              </>
            ) : (
              <span className="text-[13px] text-[#EAE4D8]/40">Not created</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_1fr] items-center gap-3 py-3">
          <div className="text-[13px] text-[#EAE4D8]/60">Wallet Role</div>
          <div className="text-[13px] text-[#F5F0E5]">EOA funds · Agent Wallet operates</div>
        </div>

        <p className="mt-1 text-[11px] leading-5 text-[#EAE4D8]/35">
          Owner EOA is used for ownership and funding. Circle Agent Wallet is the funding and runtime wallet for agent operations.
        </p>

        {!hasAgentAccount && (
          <div className="mt-4">
            {!showPasskeyRegistration ? (
              <button
                type="button"
                onClick={() => void handleCreateAgentWallet()}
                disabled={creatingAgentWallet}
                className="h-10 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:opacity-40"
              >
                {creatingAgentWallet ? 'Connecting...' : 'Create Agent Wallet'}
              </button>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={passkeyUsername}
                  onChange={(event) => {
                    setPasskeyUsername(event.target.value);
                    setAgentAccountError(null);
                  }}
                  placeholder="Choose a passkey username"
                  className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-[#0A0D12] px-3 font-mono text-[12px] text-[#F5F0E5] placeholder-[#EAE4D8]/30 outline-none focus:border-[#F3C536]/40"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => void handlePasskeyRegistration()}
                  disabled={creatingAgentWallet || !passkeyUsername.trim()}
                  className="h-10 rounded-md bg-[#F3C536] px-4 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:opacity-40"
                >
                  {creatingAgentWallet ? 'Creating...' : 'Create Passkey'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPasskeyRegistration(false);
                    setAgentAccountError(null);
                  }}
                  className="h-10 rounded-md border border-white/10 px-3 text-[12px] text-[#EAE4D8]/60 transition hover:text-[#F5F0E5]"
                >
                  Cancel
                </button>
              </div>
            )}

          </div>
        )}

        {agentAccountError && (
          <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] leading-5 text-amber-200/80">
            {agentAccountError}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
          Wallet & Funding
        </div>

        <p className="mt-2 text-[11px] leading-5 text-[#EAE4D8]/40">
          Fund the Agent Wallet from the owner EOA, then deposit Agent Wallet USDC into Gateway x402.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            ['Owner EOA USDC', ownerUsdcBalance?.formatted ?? '0.000000'],
            ['Agent Wallet USDC', agentUsdcBalance?.formatted ?? '0.000000'],
            ['Agent Gateway x402', agentGatewayBalance?.formatted ?? '0.000000'],
          ].map(([label, balance]) => (
            <div key={label} className="rounded-md border border-white/10 bg-white/[0.025] p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#EAE4D8]/38">{label}</div>
              <div className={`mt-2 text-[18px] font-semibold ${label === 'Owner EOA USDC' ? 'text-[#F5F0E5]' : 'text-[#F3C536]'}`}>
                {balancesLoading ? '...' : balance}
              </div>
            </div>
          ))}
        </div>

        {!hasAgentAccount ? (
          <p className="mt-5 rounded-md border border-white/10 bg-white/[0.025] px-4 py-3 text-[12px] leading-5 text-[#EAE4D8]/45">
            Create or link an Agent Wallet in Account Overview to enable funding and Gateway x402 deposits.
          </p>
        ) : (
          <div className="mt-5 grid gap-5">
            <div>
              <label className="text-[11px] uppercase tracking-[0.14em] text-[#EAE4D8]/70">Fund Agent Wallet (USDC)</label>
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
                  className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-[#05070A] px-3 font-mono text-[13px] text-[#F5F0E5] placeholder-[#EAE4D8]/30 outline-none focus:border-[#F3C536]/40"
                />
                <button
                  type="button"
                  onClick={() => void fundAgentAccount.fund(fundAmount, agentAccountAddress!)}
                  disabled={!fundAmount || (fundAgentAccount.step !== 'idle' && fundAgentAccount.step !== 'error')}
                  className="h-10 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:opacity-40"
                >
                  {fundAgentAccount.step === 'checking' || fundAgentAccount.step === 'transferring' || fundAgentAccount.step === 'confirming'
                    ? 'Funding...'
                    : 'Fund Agent Wallet'}
                </button>
              </div>
              {fundAgentAccount.error && <p className="mt-2 text-[11px] text-red-400">{fundAgentAccount.error}</p>}
              {fundAgentAccount.txHash && (
                <p className="mt-2 text-[11px] text-emerald-400">
                  Fund sent ✓{' '}
                  <a href={getExplorerTxUrl(fundAgentAccount.txHash)} target="_blank" rel="noreferrer" className="underline decoration-emerald-400/40 hover:text-emerald-300">
                    {shortAddress(fundAgentAccount.txHash)}
                  </a>
                </p>
              )}
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-[0.14em] text-[#EAE4D8]/70">Deposit to Gateway x402 (USDC)</label>
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
                  className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-[#05070A] px-3 font-mono text-[13px] text-[#F5F0E5] placeholder-[#EAE4D8]/30 outline-none focus:border-[#F3C536]/40"
                />
                <button
                  type="button"
                  onClick={() => void handleGatewayAction()}
                  disabled={!gatewayAmount || (agentGatewayDeposit.step !== 'idle' && agentGatewayDeposit.step !== 'error')}
                  className="h-10 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:opacity-40"
                >
                  {!circleAuthenticated
                    ? 'Login Circle'
                    : agentGatewayDeposit.step === 'checking' || agentGatewayDeposit.step === 'depositing' || agentGatewayDeposit.step === 'confirming'
                      ? 'Depositing...'
                      : 'Deposit Agent Wallet → Gateway x402'}
                </button>
              </div>
              {circleAuthenticated && circleAddress && (
                <p className="mt-2 text-[10px] text-[#EAE4D8]/30">Circle wallet: {shortAddress(circleAddress)}</p>
              )}
              {agentGatewayDeposit.error && <p className="mt-2 text-[11px] text-red-400">{agentGatewayDeposit.error}</p>}
              {agentGatewayDeposit.userOpHash && (
                <p className="mt-2 text-[11px] text-[#EAE4D8]/45">UserOp: <span className="font-mono">{shortAddress(agentGatewayDeposit.userOpHash)}</span></p>
              )}
              {agentGatewayDeposit.txHash && (
                <p className="mt-2 text-[11px] text-emerald-400">
                  Gateway deposit ✓{' '}
                  <a href={getExplorerTxUrl(agentGatewayDeposit.txHash)} target="_blank" rel="noreferrer" className="underline decoration-emerald-400/40 hover:text-emerald-300">
                    {shortAddress(agentGatewayDeposit.txHash)}
                  </a>
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void refreshProfileBalances(address, agentAccountAddress)}
            disabled={balancesLoading}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-4 text-[11px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/40 hover:text-[#F3C536] disabled:opacity-40"
          >
            <RefreshCcw className={`h-3 w-3 ${balancesLoading ? 'animate-spin' : ''}`} />
            Refresh Balances
          </button>
          {balancesError && <p className="text-[11px] text-red-400">{balancesError}</p>}
        </div>
      </div>
    </div>
  );
}
