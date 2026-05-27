'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import WalletStatus from '@/components/WalletStatus';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useGatewayBalances } from '@/hooks/useGatewayBalances';
import { useGatewayDeposit } from '@/hooks/useGatewayDeposit';
import { useGatewayWithdraw } from '@/hooks/useGatewayWithdraw';

const EXPLORER = 'https://testnet.arcscan.app';

type Tab = 'deposit' | 'withdraw';

function shortAddress(address: string) {
  if (!address) return '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function cleanAmount(value?: string | null) {
  if (!value) return '0';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function isBusy(step: string) {
  return !['idle', 'success', 'error'].includes(step);
}

function BalanceCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
        {label}
      </div>
      <div className="text-2xl font-light tabular-nums text-[#EAE4D8]">
        {value}
      </div>
      <div className="mt-1 text-xs leading-relaxed text-white/35">
        {sub}
      </div>
    </div>
  );
}

function TxLink({ hash }: { hash: string | null }) {
  if (!hash) return null;

  return (
    <Link
      href={`${EXPLORER}/tx/${hash}`}
      target="_blank"
      className="font-mono text-[11px] text-[#C5A67C]/80 underline underline-offset-4 hover:text-[#C5A67C]"
    >
      View transaction ↗️
    </Link>
  );
}

export default function WalletPage() {
  const wallet = useArcWallet();
  const { balances, loading, error, refresh } = useGatewayBalances();

  const [tab, setTab] = useState<Tab>('deposit');
  const [depositAmount, setDepositAmount] = useState('1');
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const deposit = useGatewayDeposit(refresh);
  const withdraw = useGatewayWithdraw(refresh);

  const canClaim = useMemo(() => {
    if (!balances) return false;
    return Number(balances.withdrawableUsdc || '0') > 0;
  }, [balances]);

  const walletModeLabel =
    wallet.mode === 'passkey'
      ? 'PASSKEY · CIRCLE'
      : wallet.mode === 'eoa'
        ? 'EOA WALLET'
        : 'DISCONNECTED';

  if (!wallet.ready) {
    return (
      <main className="min-h-screen bg-[#050505] px-4 py-16 text-[#EAE4D8]">
        <div className="mx-auto max-w-3xl font-mono text-xs tracking-[0.18em] text-white/40">
          LOADING WALLET…
        </div>
      </main>
    );
  }

  if (!wallet.isConnected) {
    return (
      <main className="min-h-screen bg-[#050505] px-4 py-16 text-[#EAE4D8]">
        <div className="mx-auto flex max-w-xl flex-col items-center justify-center rounded-2xl border border-[#C5A67C]/20 bg-white/[0.02] p-8 text-center">
          <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-[#C5A67C]">
            Gateway Wallet
          </div>
          <h1 className="text-3xl font-light">
            Connect your wallet first
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/45">
            Use Passkey for a simple Circle smart account, or use an EOA wallet
            like MetaMask, Coinbase Wallet, or WalletConnect.
          </p>

          <div className="mt-6">
            <WalletStatus variant="app" />
          </div>

          <p className="mt-5 font-mono text-[10px] tracking-[0.16em] text-white/30">
            ARC TESTNET · USDC
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-12 text-[#EAE4D8]">
      <div className="mx-auto max-w-5xl space-y-8">
        <section className="rounded-2xl border border-[#C5A67C]/20 bg-white/[0.02] p-6">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#C5A67C]">
                Gateway Wallet
              </div>
              <h1 className="text-3xl font-light">
                Add USDC once. Spend faster on ArcLayer.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/45">
                Gateway balance is used for fast AI agent payments. ArcLayer
                does not hold your private keys.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono">
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">
                Connected
              </div>
              <div className="mt-1 text-xs text-[#C5A67C]">
                {walletModeLabel}
              </div>
              <div className="mt-1 text-xs text-white/60">
                {shortAddress(wallet.address)}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <BalanceCard
            label="Wallet USDC"
            value={`${cleanAmount(balances?.walletUsdc)} USDC`}
            sub="Still in your wallet. You can deposit this."
          />
          <BalanceCard
            label="Gateway Balance"
            value={`${cleanAmount(balances?.gatewayAvailableUsdc)} USDC`}
            sub="Ready to spend on ArcLayer agent services."
          />
          <BalanceCard
            label="Pending Withdrawal"
            value={`${cleanAmount(balances?.withdrawingUsdc)} USDC`}
            sub={
              balances?.blocksRemaining && balances.blocksRemaining !== '0'
                ? `${balances.blocksRemaining} blocks remaining.`
                : 'No active waiting period.'
            }
          />
          <BalanceCard
            label="Claimable"
            value={`${cleanAmount(balances?.withdrawableUsdc)} USDC`}
            sub="Ready to claim back to your wallet."
          />
        </section>

        {loading && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 font-mono text-xs text-white/40">
            Refreshing balances…
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="mb-6 flex gap-2">
            <button
              type="button"
              onClick={() => setTab('deposit')}
              className={`rounded-lg px-4 py-2 font-mono text-[11px] tracking-[0.16em] transition ${
                tab === 'deposit'
                  ? 'bg-[#C5A67C] text-black'
                  : 'border border-white/10 text-white/50 hover:text-white/80'
              }`}
            >
              DEPOSIT
            </button>
            <button
              type="button"
              onClick={() => setTab('withdraw')}
              className={`rounded-lg px-4 py-2 font-mono text-[11px] tracking-[0.16em] transition ${
                tab === 'withdraw'
                  ? 'bg-[#C5A67C] text-black'
                  : 'border border-white/10 text-white/50 hover:text-white/80'
              }`}
            >
              WITHDRAW
            </button>
          </div>

          {tab === 'deposit' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-light">Add funds to Gateway</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/45">
                  Move USDC from your wallet into Gateway. After deposit, your
                  balance can be used for fast ArcLayer payments.
                </p>
              </div>

              <div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                  Amount
                </label>
                <input
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  disabled={isBusy(deposit.step)}
                  inputMode="decimal"
                  placeholder="1.00"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-xl font-light text-white outline-none focus:border-[#C5A67C]/50 disabled:opacity-50"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {['1', '5', '10'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDepositAmount(value)}
                    disabled={isBusy(deposit.step)}
                    className="rounded-lg border border-white/10 px-4 py-2 font-mono text-[11px] text-white/50 hover:border-[#C5A67C]/40 hover:text-[#C5A67C] disabled:opacity-50"
                  >
                    {value} USDC
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDepositAmount(balances?.walletUsdc || '0')}
                  disabled={isBusy(deposit.step)}
                  className="rounded-lg border border-white/10 px-4 py-2 font-mono text-[11px] text-white/50 hover:border-[#C5A67C]/40 hover:text-[#C5A67C] disabled:opacity-50"
                >
                  MAX
                </button>
              </div>

              <button
                type="button"
                onClick={() => deposit.deposit(depositAmount)}
                disabled={!depositAmount || isBusy(deposit.step)}
                className="w-full rounded-xl bg-[#EAE4D8] px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-black transition hover:bg-white disabled:bg-white/10 disabled:text-white/30"
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
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {deposit.error}
                </div>
              )}

              {deposit.step === 'success' && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                  Deposit confirmed. Your Gateway balance will update shortly.
                  <div className="mt-2">
                    <TxLink hash={deposit.txHash} />
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'withdraw' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-light">Withdraw back to wallet</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/45">
                  This is the trustless recovery withdrawal path. After you start,
                  the amount cannot be used for payments. You can claim it after
                  the waiting period.
                </p>
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-100/70">
                Repeated withdrawal starts can add to the pending amount and reset
                the timer. Start only when you are sure.
              </div>

              <div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                  Amount to start withdrawal
                </label>
                <input
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  disabled={isBusy(withdraw.step)}
                  inputMode="decimal"
                  placeholder="1.00"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-xl font-light text-white outline-none focus:border-[#C5A67C]/50 disabled:opacity-50"
                />
              </div>

              <div className="flex flex-col gap-3 md:flex-row">
                <button
                  type="button"
                  onClick={() => withdraw.initiateWithdrawal(withdrawAmount)}
                  disabled={!withdrawAmount || isBusy(withdraw.step)}
                  className="flex-1 rounded-xl bg-[#EAE4D8] px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-black transition hover:bg-white disabled:bg-white/10 disabled:text-white/30"
                >
                  {withdraw.step === 'initiating'
                    ? 'STARTING…'
                    : withdraw.step === 'confirming'
                      ? 'CONFIRMING…'
                      : 'START WITHDRAWAL'}
                </button>

                <button
                  type="button"
                  onClick={() => withdraw.claimWithdrawal()}
                  disabled={!canClaim || isBusy(withdraw.step)}
                  className="flex-1 rounded-xl border border-[#C5A67C]/40 px-5 py-3 font-mono text-[11px] tracking-[0.18em] text-[#C5A67C] transition hover:bg-[#C5A67C]/10 disabled:border-white/10 disabled:text-white/25"
                >
                  {withdraw.step === 'claiming' ? 'CLAIMING…' : 'CLAIM READY FUNDS'}
                </button>
              </div>

              {balances?.blocksRemaining && balances.blocksRemaining !== '0' && (
                <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-xs text-white/45">
                  Claim unlock block: {balances.withdrawalBlock}
                  <br />
                  Current block: {balances.currentBlock}
                  <br />
                  Remaining: {balances.blocksRemaining} blocks
                </div>
              )}

              {withdraw.error && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {withdraw.error}
                </div>
              )}

              {withdraw.step === 'success' && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                  Transaction confirmed.
                  <div className="mt-2">
                    <TxLink hash={withdraw.txHash} />
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C]">
            Simple explanation
          </h3>
          <div className="mt-4 grid gap-3 text-sm leading-relaxed text-white/45 md:grid-cols-3">
            <div>
              <strong className="text-white/70">Wallet USDC</strong>
              <br />
              Normal USDC still inside your connected wallet.
            </div>
            <div>
              <strong className="text-white/70">Gateway Balance</strong>
              <br />
              USDC deposited into Gateway and ready for fast ArcLayer payments.
            </div>
            <div>
              <strong className="text-white/70">Withdrawal</strong>
              <br />
              Recovery path to move USDC back to your wallet after the waiting period.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
