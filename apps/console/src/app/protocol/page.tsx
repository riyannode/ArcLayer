'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ARC_EXPLORER, CONTRACTS, formatUSDC } from '@/lib/contracts';
import { fetchIndexerJson, type DashboardOverview } from '@/lib/indexer';


const RPC_ENDPOINTS = [
  { label: 'blockdaemon', url: 'https://rpc.blockdaemon.testnet.arc.network' },
  { label: 'drpc', url: 'https://rpc.drpc.testnet.arc.network' },
  { label: 'quicknode', url: 'https://rpc.quicknode.testnet.arc.network' },
];


function copyToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

type RpcHealth = { label: string; latency: number | null; blockNumber: bigint | null; ok: boolean };

async function probeRpc(url: string): Promise<{ blockNumber: bigint | null; latency: number }> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      cache: 'no-store',
    });
    const latency = performance.now() - t0;
    if (!res.ok) return { blockNumber: null, latency };
    const data = await res.json();
    return { blockNumber: data.result ? BigInt(data.result) : null, latency };
  } catch {
    return { blockNumber: null, latency: performance.now() - t0 };
  }
}

export default function Dashboard() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [rpcHealth, setRpcHealth] = useState<RpcHealth[]>([]);
  const [chainHead, setChainHead] = useState<bigint | null>(null);

  const [lastSyncedBlock, setLastSyncedBlock] = useState<bigint | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const pulseRef = useRef<HTMLSpanElement>(null);

  async function loadOverview(options?: { silent?: boolean }) {
    try {
      if (options?.silent) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      const overviewPath = options?.silent ? '/overview/summary' : '/overview';
      const [next, rootRes] = await Promise.all([
        fetchIndexerJson<DashboardOverview>(overviewPath),
        fetchIndexerJson<{ lastSyncedBlock?: string; eventCount?: number }>('/').catch(() => ({} as { lastSyncedBlock?: string })),
      ]);
      if (options?.silent) {
        setOverview((prev) => (prev ? { ...prev, summary: next.summary } : prev));
      } else {
        setOverview(next);
      }

      if (rootRes?.lastSyncedBlock) setLastSyncedBlock(BigInt(rootRes.lastSyncedBlock));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load protocol dashboard.');
      if (!options?.silent) setOverview(null);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setTickCount((t) => t + 1);
      if (pulseRef.current) {
        pulseRef.current.classList.remove('pulse-once');
        void pulseRef.current.offsetWidth;
        pulseRef.current.classList.add('pulse-once');
      }
    }
  }

  async function probeAllRpcs() {
    const results = await Promise.all(
      RPC_ENDPOINTS.map(async (ep) => {
        const { blockNumber, latency } = await probeRpc(ep.url);
        return { label: ep.label, latency, blockNumber, ok: blockNumber !== null };
      })
    );
    setRpcHealth(results);
    const heads = results.map((r) => r.blockNumber).filter((b): b is bigint => b !== null);
    if (heads.length > 0) setChainHead(heads.reduce((a, b) => (a > b ? a : b)));
  }

  useEffect(() => {
    const loadOverviewWhenVisible = () => {
      if (!document.hidden) void loadOverview({ silent: true });
    };
    const probeRpcsWhenVisible = () => {
      if (!document.hidden) void probeAllRpcs();
    };
    const onVisibility = () => {
      if (!document.hidden) {
        void loadOverview({ silent: true });
        void probeAllRpcs();
      }
    };

    loadOverview();
    probeAllRpcs();
    const indexerTick = window.setInterval(loadOverviewWhenVisible, 30000);
    const rpcTick = window.setInterval(probeRpcsWhenVisible, 30000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(indexerTick);
      window.clearInterval(rpcTick);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const summary = overview?.summary;

  const blocksSinceLastEvent = chainHead && lastSyncedBlock ? Number(chainHead - lastSyncedBlock) : null;
  // Health: active protocol = events fire regularly. Dormant testnet = expected silence.
  // Testnet Arc ~2s block time → 1800 blocks/hr. Up to ~50k blocks (~28hrs) is normal for low-traffic testnet.
  const healthTone = blocksSinceLastEvent === null ? 'pending'
    : rpcHealth.every((r) => r.ok) ? 'active' : 'error';
  const healthLabel = blocksSinceLastEvent === null ? 'probing'
    : rpcHealth.every((r) => r.ok) ? 'healthy' : 'degraded';

  const fastestRpc = rpcHealth.length > 0 ? rpcHealth.reduce((a, b) => {
    if (!a.ok) return b;
    if (!b.ok) return a;
    return (a.latency ?? 9999) < (b.latency ?? 9999) ? a : b;
  }) : null;



  return (
    <div className="relative px-6 py-16 md:px-10 md:py-24">
      <div className="mx-auto max-w-7xl">
        {/* Hero + primary actions */}
        <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="aureo-mono-label mb-3">PROTOCOL · LIVE CONSOLE</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[60px]" style={{ lineHeight: 0.95 }}>
              Protocol <span className="italic" style={{ color: '#C5A67C' }}>Console</span>
            </h1>
            <p className="mt-4 max-w-2xl font-mono text-[12px] leading-6 invisible" style={{ color: 'rgba(234, 228, 216, 0.88)' }}>
              Live protocol activity at a glance.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/" className="btn-primary px-4 py-2 text-[10.5px]">HOME X402</Link>
              <Link href="/jobs/manual" className="btn-secondary px-4 py-2 text-[10.5px]">CREATE JOB</Link>
              <Link href="/register" className="btn-bordered px-4 py-2 text-[10.5px]">REGISTER AGENT</Link>

            </div>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto">
            <div className="flex items-center gap-2 rounded-sm border border-white/10 bg-black/40 px-3 py-2">
              <span
                ref={pulseRef}
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: error ? '#e68282' : '#B8CD7E', boxShadow: `0 0 8px ${error ? '#e68282' : '#B8CD7E'}` }}
              />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.2em]" style={{ color: 'rgba(234, 228, 216, 0.7)' }}>
                {error ? 'offline' : isRefreshing ? 'syncing' : 'live'} · tick {tickCount}
              </span>
            </div>
            <button onClick={() => { loadOverview({ silent: true }); probeAllRpcs(); }} className="btn-bordered">
              {isRefreshing ? 'SYNCING…' : 'REFRESH'}
            </button>
          </div>
        </div>

        {/* Live status + payment rails */}
        <div className="mb-8 grid grid-cols-1 gap-3 lg:grid-cols-[0.95fr_1.15fr_0.9fr]">
          <Panel title="LIVE MODULES" sub="Core services">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {['ERC-8004 IdentityRegistry', 'ERC-8183 AgenticCommerce', 'USDC', 'x402', 'Indexer'].map((name) => (
                <div key={name} className="flex items-center gap-2 rounded-sm border border-[#B8CD7E]/15 bg-[#B8CD7E]/[0.035] px-3 py-2 font-mono text-[10.5px] text-[rgba(234,228,216,0.9)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#B8CD7E]" aria-hidden="true" />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="PAYMENT RAILS"
            sub="Pay-per-call or escrow"
            action={<Link href="/api/x402/supported" className="font-mono text-[11px]" style={{ color: '#C5A67C' }}>INSPECT CONFIG ↗</Link>}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <RailCard title="Arc Native x402" status="LIVE" text="Pay once for a single agent call." href="/" cta="Open homepage ticket" />
              <RailCard title="ERC-8183 Jobs" status="LIVE" text="Budget, fund, submit, and complete official AgenticCommerce jobs." href="/jobs/manual" cta="Create job" />
            </div>
          </Panel>

          <Panel title="NETWORK STATUS" sub={fastestRpc ? `fastest rpc: ${fastestRpc.label} (${fastestRpc.latency?.toFixed(0)}ms)` : 'probing rpcs'}>
            <div className="flex flex-col gap-3">
              <StatusLine label="NETWORK" value="Arc Testnet" />
              <StatusLine label="RPC" value={rpcHealth.every((r) => r.ok) && rpcHealth.length ? 'Healthy' : 'Probing'} tone={rpcHealth.every((r) => r.ok) && rpcHealth.length ? 'success' : 'pending'} />
              <StatusLine label="INDEXER" value={healthLabel} tone={healthTone === 'active' ? 'success' : healthTone} />
              <StatusLine label="LAST EVENT" value={lastSyncedBlock ? `#${lastSyncedBlock.toString()}` : '—'} />
              <StatusLine label="EVENTS INDEXED" value={String(summary?.eventCount ?? '—')} />
              <details className="mt-1 border-t border-white/5 pt-3">
                <summary className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.7)] hover:text-[#C5A67C]">Advanced RPC diagnostics</summary>
                <div className="mt-3 space-y-2">
                  {rpcHealth.length === 0
                    ? RPC_ENDPOINTS.map((ep) => <RpcRow key={ep.label} label={ep.label} latency={null} blockNumber={null} ok={false} loading url={ep.url} />)
                    : rpcHealth.map((r) => {
                        const ep = RPC_ENDPOINTS.find((e) => e.label === r.label);
                        return <RpcRow key={r.label} {...r} url={ep?.url} />;
                      })}
                </div>
              </details>
            </div>
          </Panel>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {[
            { k: 'JOBS', v: isLoading ? '…' : String(summary?.jobs ?? 0) },
            { k: 'AGENTS', v: isLoading ? '…' : String(summary?.agents ?? 0) },
            { k: 'BUDGETED · USDC', v: isLoading || !summary ? '…' : formatUSDC(BigInt(summary.totalBudget)) },
            { k: 'FUNDED · USDC', v: isLoading || !summary ? '…' : formatUSDC(BigInt(summary.totalFunded)) },
          ].map((s, i) => (
            <div
              key={s.k}
              className="flex flex-col gap-3 p-5"
              style={{
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(10, 10, 10, 0.6)',
                animation: `fadeInUp 0.4s ${i * 0.05}s both cubic-bezier(0.16, 1, 0.3, 1)`,
              }}
            >
              <span className="aureo-mono-label">{s.k}</span>
              <span className="aureo-display text-[34px] text-[#EAE4D8] md:text-[42px]" style={{ lineHeight: 1 }}>{s.v}</span>
              <span className="h-px w-8 bg-[#C5A67C]/50" />
            </div>
          ))}
        </div>


      </div>
    </div>
  );
}


function Panel({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="p-5 md:p-6" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="aureo-mono-label" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>{title}</div>
          {sub && <div className="mt-1 font-mono text-[10.5px]" style={{ color: 'rgba(234, 228, 216, 0.35)' }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function RpcRow({ label, latency, blockNumber, ok, loading, url }: RpcHealth & { loading?: boolean; url?: string }) {
  const tone = loading ? 'pending' : ok ? 'active' : 'error';
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-white/5 bg-black/30 px-3 py-2 transition hover:border-[#C5A67C]/30">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: loading ? '#C5A67C' : ok ? '#B8CD7E' : '#e68282', boxShadow: `0 0 6px ${loading ? '#C5A67C' : ok ? '#B8CD7E' : '#e68282'}` }}
        />
        <span className="truncate font-mono text-[11px]" style={{ color: 'rgba(234, 228, 216, 0.85)' }}>{label}</span>
        {url && (
          <button
            onClick={() => copyToClipboard(url)}
            className="font-mono text-[9px] uppercase tracking-wider hover:text-[#C5A67C]"
            style={{ color: 'rgba(234, 228, 216, 0.3)' }}
            title="copy rpc url"
          >
            copy
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 font-mono text-[10.5px]">
        <span style={{ color: latency && latency < 100 ? '#B8CD7E' : 'rgba(234, 228, 216, 0.5)' }}>{latency === null ? '—' : `${latency.toFixed(0)}ms`}</span>
        <span style={{ color: 'rgba(234, 228, 216, 0.5)' }}>{blockNumber ? `#${blockNumber.toString().slice(-6)}` : '—'}</span>
        <span className={`chip-status ${tone}`}>{loading ? 'probe' : ok ? 'ok' : 'down'}</span>
      </div>
    </div>
  );
}


function RailCard({ title, status, text, href, cta }: { title: string; status: string; text: string; href: string; cta: string }) {
  const tone = status === 'LIVE' ? '#B8CD7E' : '#C5A67C';
  return (
    <Link href={href} className="flex flex-col gap-2 rounded-sm border border-white/10 bg-black/30 p-3 transition hover:border-[#C5A67C]/40">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium" style={{ color: '#EAE4D8' }}>{title}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: tone }}>{status}</span>
      </div>
      <p className="font-mono text-[10px] leading-4 invisible" style={{ color: 'rgba(234, 228, 216, 0.55)' }}>{text}</p>
      <span className="mt-auto font-mono text-[9.5px] uppercase tracking-[0.14em]" style={{ color: '#C5A67C' }}>{cta} →</span>
    </Link>
  );
}

function StatusLine({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const color = tone === 'success' ? '#B8CD7E' : tone === 'pending' ? '#C5A67C' : '#EAE4D8';
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-[11px]" style={{ color: 'rgba(234, 228, 216, 0.55)' }}>{label}</span>
      <span className="font-mono text-[11.5px]" style={{ color }}>{value}</span>
    </div>
  );
}



