'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readContract, waitForTransactionReceipt } from '@wagmi/core';
import { getAddress, type Hex } from 'viem';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useArcWrite } from '@/hooks/useArcWrite';
import { useRail, railQueryParams } from '@/components/rail/RailProvider';
import { CONTRACTS, JOB_ESCROW_ABI, buildApproveUsdcConfig, buildCreateJobConfig, buildFundJobConfig, buildSetBudgetConfig } from '@arclayer/sdk';
import { formatUSDC, shortenAddress } from '@/lib/contracts';
import { parseUSDC } from '@/lib/contracts';
import { config } from '@/lib/wagmi';
import { CopyButton } from '@/components/CopyButton';
import { X402ActionGate } from '@/components/x402/X402ActionGate';
import { IndexerDegradedBanner } from '@/components/IndexerDegradedBanner';
import { loadAgentDetail, type DataSource } from '@/lib/indexer';

const INDEXER_BASE_URL = process.env.NEXT_PUBLIC_INDEXER_URL || '/api/indexer';

const ARC_CHAIN_ID = 5042002;
const USDC = getAddress('0x3600000000000000000000000000000000000000');

function randomNonce(): Hex {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}
function b64(value: unknown) { return btoa(JSON.stringify(value)); }

type IndexedJob = {
  id: string;
  agentId: string;
  client: string;
  worker: string;
  evaluator: string;
  budget: string;
  fundedAmount: string;
  createdAt: string;
  jobSpecHash: string;
  deliverableURI: string;
  proofMetadataURI: string;
  approved: boolean;
  status: number;
};

type IndexedProof = {
  tokenId: string;
  jobId: string;
  agentId: string;
  payer: string;
  amountPaid: string;
  mintedAt: string;
  metadataURI: string;
};

type IndexedAgent = {
  agentId: string;
  controller: string;
  skillHash: string;
  metadataURI: string;
  registeredAt: string;
  reputationScore: string;
  score: string;
  jobs: string[];
  proofTokenIds: string[];
};

type AgentDetail = {
  agent: IndexedAgent;
  jobs: IndexedJob[];
  proofs: IndexedProof[];
};

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Evaluated', 'Settled', 'Cancelled'] as const;
const JOB_TONE: Record<number, string> = { 0: '', 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'success', 6: 'error' };

function parseAgentId(value: string | undefined) {
  return value && /^\d+$/.test(value) ? value : null;
}

function buildReputationSeries(agent: IndexedAgent | undefined, jobs: IndexedJob[], proofs: IndexedProof[]) {
  const baseScore = Number(agent?.score ?? 0);
  const reputation = Number(agent?.reputationScore ?? baseScore);
  const completedJobs = jobs.filter((job) => job.approved || job.status >= 3).length;
  const proofBoost = proofs.length * 2;
  const seed = Math.max(0, reputation - completedJobs - proofBoost);
  return [
    seed,
    seed + Math.ceil(completedJobs / 2),
    seed + completedJobs,
    Math.max(baseScore, reputation) + proofBoost,
  ];
}

function Sparkline({ values }: { values: number[] }) {
  const safe = values.length > 1 ? values : [0, 0];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = max - min || 1;
  const points = safe
    .map((v, i) => {
      const x = (i / (safe.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 100 100" className="h-20 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#C5A67C" stopOpacity="0.35" />
          <stop offset="1" stopColor="#C5A67C" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,100 ${points} 100,100`}
        fill="url(#sparkFill)"
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke="#C5A67C"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {safe.map((v, i) => {
        const x = (i / (safe.length - 1)) * 100;
        const y = 100 - ((v - min) / range) * 100;
        return <circle key={i} cx={x} cy={y} r="1.2" fill="#EAE4D8" />;
      })}
    </svg>
  );
}

export default function AgentProfilePage() {
  const params = useParams<{ id: string }>();
  const { address, isConnected } = useArcWallet();
  const { writeContractAsync } = useArcWrite();
  const { rail } = useRail();
  const agentId = parseAgentId(params.id);
  const [profile, setProfile] = useState<AgentDetail | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>('indexer');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [runInput, setRunInput] = useState('Run a paid test task through x402.');
  const [runBudget, setRunBudget] = useState('1');
  const [runState, setRunState] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!agentId) { setError('Invalid agent id.'); setIsLoading(false); return; }
      try {
        setIsLoading(true); setError(null);
        const { data, source } = await loadAgentDetail(agentId);
        if (!cancelled) { setProfile(data); setDataSource(source); }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'Failed to load agent profile.'); setProfile(null); }
      } finally { if (!cancelled) setIsLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [agentId]);

  const agent = profile?.agent;
  const jobs = profile?.jobs || [];
  const proofs = profile?.proofs || [];
  const series = buildReputationSeries(agent, jobs, proofs);

  async function handlePaidRun() {
    if (!agent || !agentId || !address) return;
    try {
      setIsRunning(true);

      // ─── Step 1: Get x402 402 challenge ────────────────────────────────
      // Rail + payer must be passed as QUERY PARAMS (middleware reads them
      // from req.nextUrl.searchParams, not from headers).
      setRunState('1/5 Requesting x402 challenge from /api/agents/:id/run...');
      const qs = railQueryParams(rail, address);
      const challengeUrl = `/api/agents/${agentId}/run${qs ? `?${qs}` : ''}`;
      const first = await fetch(challengeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: runInput }),
      });
      if (first.status !== 402) {
        throw new Error(`Expected x402 challenge (HTTP 402), received HTTP ${first.status}.`);
      }
      const challenge = await first.json();
      if (!Array.isArray(challenge.accepts) || challenge.accepts.length === 0) {
        throw new Error('x402 challenge missing accepts[] requirements.');
      }
      type Requirement = {
        scheme: 'exact';
        network: string;
        asset: `0x${string}`;
        amount: string;
        payTo: `0x${string}`;
        maxTimeoutSeconds: number;
        extra?: Record<string, unknown>;
      };
      const accepts = challenge.accepts as Requirement[];
      // Pick native USDC requirement (skip Gateway-batched if rail===native).
      const req = accepts.find((a) => !a.extra?.name || a.extra?.name === 'USDC') || accepts[0];

      // ─── Step 2: Optional JobEscrow funding (on-chain provenance) ──────
      // Funds the job for indexer/protocol audit trail. Independent of x402
      // payment — x402 verifies the resource access, JobEscrow records the
      // job for proof-of-work tracking.
      const amount = parseUSDC(runBudget);
      const nextJobId = (await readContract(config, {
        address: CONTRACTS.JOB_ESCROW,
        abi: JOB_ESCROW_ABI,
        functionName: 'jobCounter',
      }) as bigint) + BigInt(1);
      setRunState('2/5 Creating JobEscrow run for agent worker...');
      const serviceWorker = (process.env.NEXT_PUBLIC_WORKER_ADDR as `0x${string}` | undefined) ?? (agent.controller as `0x${string}`);
      const createHash = await writeContractAsync(buildCreateJobConfig(BigInt(agentId), serviceWorker, address, runInput));
      await waitForTransactionReceipt(config, { hash: createHash });

      setRunState('3/5 Setting budget, approving USDC, funding job...');
      const visibleJobId = nextJobId;
      const budgetHash = await writeContractAsync(buildSetBudgetConfig(visibleJobId, amount));
      await waitForTransactionReceipt(config, { hash: budgetHash });
      const approveHash = await writeContractAsync(buildApproveUsdcConfig(amount));
      await waitForTransactionReceipt(config, { hash: approveHash });
      const fundHash = await writeContractAsync(buildFundJobConfig(visibleJobId, amount));
      await waitForTransactionReceipt(config, { hash: fundHash });

      // ─── Step 3: Sign EIP-3009 transferWithAuthorization ───────────────
      setRunState('4/5 Signing EIP-3009 authorization for x402 payment...');
      const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!eth) throw new Error('No injected wallet found. Connect EOA wallet to sign x402 payment.');
      // Ensure wallet on Arc Testnet.
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${ARC_CHAIN_ID.toString(16)}` }] });
      } catch (e) {
        const err = e as { code?: number };
        if (err.code !== 4902) throw e;
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: `0x${ARC_CHAIN_ID.toString(16)}`,
            chainName: 'Arc Testnet',
            nativeCurrency: { name: 'Arc', symbol: 'ARC', decimals: 18 },
            rpcUrls: ['https://rpc.testnet.arc.network'],
            blockExplorerUrls: ['https://testnet.arcscan.app'],
          }],
        });
      }

      const validBefore = String(Math.floor(Date.now() / 1000) + 600);
      const nonce = randomNonce();
      const paymentPayload = {
        x402Version: 2,
        accepted: {
          ...req,
          asset: getAddress(req.asset),
          payTo: getAddress(req.payTo),
          extra: { name: 'USDC', version: '2', decimals: 6, symbol: 'USDC' },
        },
        payload: {
          signature: '0x' as Hex,
          authorization: { from: address, to: getAddress(req.payTo), value: req.amount, validAfter: '0', validBefore, nonce },
        },
      };
      paymentPayload.payload.signature = (await eth.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify({
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
            ],
            TransferWithAuthorization: [
              { name: 'from', type: 'address' },
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'validAfter', type: 'uint256' },
              { name: 'validBefore', type: 'uint256' },
              { name: 'nonce', type: 'bytes32' },
            ],
          },
          primaryType: 'TransferWithAuthorization',
          domain: { name: 'USDC', version: '2', chainId: ARC_CHAIN_ID, verifyingContract: USDC },
          message: {
            from: address,
            to: getAddress(req.payTo),
            value: `0x${BigInt(req.amount).toString(16)}`,
            validAfter: '0x0',
            validBefore: `0x${BigInt(validBefore).toString(16)}`,
            nonce,
          },
        })],
      })) as Hex;

      // ─── Step 4: Retry with X-PAYMENT header ───────────────────────────
      setRunState('5/5 Posting paid run with X-PAYMENT (server verifies + settles)...');
      const xPaymentHeader = b64(paymentPayload);
      const paid = await fetch(challengeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-PAYMENT': xPaymentHeader,
        },
        body: JSON.stringify({ input: runInput, jobId: visibleJobId.toString() }),
      });
      const payload = await paid.json();
      if (!paid.ok) throw new Error(payload.message || payload.error || `Paid run failed with HTTP ${paid.status}.`);
      setRunState(`Job #${visibleJobId.toString()} settled. JobEscrow tx: ${fundHash.slice(0, 10)}... | Run: ${payload.run?.status ?? 'submitted'}.`);
    } catch (e) {
      setRunState(e instanceof Error ? e.message : 'Paid run failed.');
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="aureo-detail-hero mb-8 p-5 md:p-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/protocol" className="font-mono text-[11px] tracking-[0.16em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]">
              ← BACK · CONSOLE
            </Link>
            <div className="aureo-mono-label mt-5 mb-3">PROTOCOL · AGENT</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
              Agent <span className="italic text-[#C5A67C]">#{agentId || '0'}</span>
            </h1>
            <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[#b5b5b5] invisible">
              Indexed capability profile and work-proof history from the ArcLayer indexer.
            </p>
          </div>
          <Link href="/docs" className="btn-primary self-start md:self-auto">SDK QUICKSTART</Link>
        </div>

        <X402ActionGate lockedMessage="Pay x402 on homepage to unlock agent actions">
        <IndexerDegradedBanner visible={dataSource === 'rpc'} className="mb-6" />

        <section className="mb-6 p-6" style={{ border: '1px solid rgba(197, 166, 124, 0.22)', background: 'rgba(10, 10, 10, 0.68)' }}>
          <div className="aureo-mono-label mb-2">X402 · BUYER RUN</div>
          <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Payment-required agent call</h2>
          <p className="mt-2 max-w-3xl font-mono text-[11.5px] leading-5 text-[#b5b5b5] invisible">
            Calls <span className="text-[#C5A67C]">POST /api/agents/{agentId}/run</span>, receives a 402 challenge, registers a funded JobEscrow payment on Arc Testnet, then retries with X-PAYMENT.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_auto]">
            <input value={runInput} onChange={(e) => setRunInput(e.target.value)} className="input-mono" placeholder="buyer task / prompt" />
            <input value={runBudget} onChange={(e) => setRunBudget(e.target.value)} className="input-mono" placeholder="USDC" />
            <button onClick={handlePaidRun} disabled={!isConnected || !agent || isRunning} className="btn-primary">
              {isRunning ? 'RUNNING...' : 'PAY · RUN'}
            </button>
          </div>
          <div className="mt-4 p-4 font-mono text-[11.5px] leading-5 text-[#b5b5b5]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
            {runState || (isConnected ? 'Wallet connected. Needs testnet USDC for approval/funding.' : 'Connect a wallet on Arc Testnet 5042002 to test end-to-end.')}
          </div>
        </section>
        </X402ActionGate>

        {error && (
          <div className="mb-6 p-4" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <p className="font-mono text-[11.5px] text-[#f0c5c5]">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="aureo-panel p-4 md:p-6 min-w-0">
            <div className="aureo-mono-label mb-2">REGISTRY</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Record</h2>
            <div className="mt-5 space-y-2.5">
              {([
                { label: 'controller', value: agent?.controller, display: agent ? shortenAddress(agent.controller) : isLoading ? '…' : '—', copyable: !!agent?.controller },
                { label: 'skill hash', value: agent?.skillHash, display: agent ? `${agent.skillHash.slice(0, 10)}…${agent.skillHash.slice(-8)}` : isLoading ? '…' : '—', copyable: !!agent?.skillHash },
                { label: 'metadata', value: agent?.metadataURI, display: agent?.metadataURI || (isLoading ? '…' : '—'), copyable: !!agent?.metadataURI },
                { label: 'registered', value: undefined, display: agent ? new Date(Number(agent.registeredAt) * 1000).toLocaleString() : isLoading ? '…' : '—', copyable: false },
              ] as const).map((row) => (
                <div key={row.label} className="ledger-row flex flex-col gap-2 border border-white/10 bg-black/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <span className="font-mono text-[10.5px] tracking-[0.14em] text-[#a0a0a0] sm:shrink-0">{row.label}</span>
                  <div className="flex min-w-0 flex-1 items-center gap-2 sm:justify-end">
                    <span
                      className="block min-w-0 flex-1 truncate font-mono text-[11.5px] text-[#EAE4D8] sm:flex-none sm:max-w-[60%]"
                      title={typeof row.value === 'string' ? row.value : undefined}
                    >
                      {row.display}
                    </span>
                    {row.copyable && row.value ? (
                      <CopyButton text={row.value} label="COPY" className="shrink-0 px-2 py-1 text-[9px]" />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">TELEMETRY</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Protocol signals</h2>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ['SCORE', agent ? agent.score : isLoading ? '…' : '0'],
                ['JOBS', String(jobs.length)],
                ['PROOFS', String(proofs.length)],
              ].map(([label, value], i) => (
                <div key={label} className="p-4" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)', animation: `fadeInUp 0.4s ${i * 0.05}s both cubic-bezier(0.16, 1, 0.3, 1)` }}>
                  <p className="aureo-mono-label">{label}</p>
                  <p className="mt-2 aureo-display text-[28px] text-[#EAE4D8]">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 p-4" style={{ border: '1px solid rgba(197, 166, 124, 0.2)', background: 'rgba(0,0,0,0.3)' }}>
              <div className="flex items-center justify-between">
                <p className="aureo-mono-label" style={{ color: '#C5A67C' }}>REPUTATION · TREND</p>
                <span className="font-mono text-[11px] text-[#C5A67C]">{series[series.length - 1]}</span>
              </div>
              <div className="mt-3">
                <Sparkline values={series} />
              </div>
              <p className="mt-2 font-mono text-[10.5px] leading-5 text-[#a0a0a0] invisible">
                Reputation projected from ReputationOracle, coupled to paid WorkProof mints.
              </p>
            </div>
          </section>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">JOBS</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Linked jobs</h2>
            <div className="mt-5 space-y-3">
              {jobs.length > 0 ? (
                jobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/job/${job.id}`}
                    className="ledger-row block border border-white/10 bg-black/20 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-[12.5px] text-[#EAE4D8]">Job #{job.id}</span>
                      <span className="font-mono text-[11px] text-[#C5A67C]">{formatUSDC(BigInt(job.budget))} USDC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10.5px] text-[#a0a0a0]">
                      <span>worker {shortenAddress(job.worker)}</span>
                      <span className={`chip-status ${JOB_TONE[job.status] ?? 'pending'}`}>{JOB_STATUS[job.status] || job.status}</span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="p-4 font-mono text-[11.5px] text-[#a0a0a0]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
                  {isLoading ? 'Loading jobs…' : 'No jobs for this agent yet.'}
                </p>
              )}
            </div>
          </section>

          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">PROOF OF WORK</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Soulbound history</h2>
            <div className="mt-5 space-y-3">
              {proofs.length > 0 ? (
                proofs.map((p) => (
                  <div key={p.tokenId} className="ledger-row border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-[12.5px] text-[#EAE4D8]">Job #{p.jobId}</span>
                      <span className="font-mono text-[11px] text-[#C5A67C]">{formatUSDC(BigInt(p.amountPaid))} USDC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10.5px] text-[#a0a0a0]">
                      <span>payer {shortenAddress(p.payer)}</span>
                      <span>{new Date(Number(p.mintedAt) * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="p-4 font-mono text-[11.5px] text-[#a0a0a0]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
                  {isLoading ? 'Loading proofs…' : 'No WorkProofs minted for this agent yet.'}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
