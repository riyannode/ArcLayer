'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import type {
  A2AOnChain,
  AutonomousFeed,
  FeedItem,
  NetworkAgent,
  Overview,
  RegisteredAgent,
} from '@/types/agent-network';
import { buildAgentNetwork } from '@/lib/a2a/build-agent-network';
import { fetchIndexerJson } from '@/lib/indexer';
import type { AgentDetail, IndexedJob, IndexedProof } from '@/lib/indexer';
import type { AgentManifestV1 } from '@/lib/a2a/manifest';
import { AvatarUploader } from '@/components/agent/AvatarUploader';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'reputation' | 'activity' | 'jobs' | 'receipts';

const TABS: { key: Tab; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'reputation', label: 'Reputation' },
  { key: 'activity', label: 'A2A Activity' },
  { key: 'jobs', label: 'Job History' },
  { key: 'receipts', label: 'Receipts' },
];

function short(addr: string) {
  if (!addr || addr.length < 12) return addr || '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatUSDCRaw(raw: string) {
  const n = Number(raw) / 1e6;
  if (n > 0 && n < 0.01) return n.toFixed(3);
  if (n < 1) return n.toFixed(3);
  return n.toFixed(2);
}

function timeAgoIso(iso: string) {
  const diff = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (diff < 0) return 'now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const TYPE_COLORS: Record<FeedItem['type'], string> = {
  signal: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  payment: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  decision: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  trade: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  balance: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Completed'] as const;

// ─── Sub-components ──────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-white/5 bg-white/[0.02] px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#555]">{label}</p>
      <p className="mt-1 truncate font-mono text-sm text-[#EAE4D8]">{value}</p>
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  return (
    <div className="flex items-start gap-3 border-b border-white/5 px-1 py-2.5">
      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${TYPE_COLORS[item.type]}`}>
        {item.type}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-[#EAE4D8]">
          <span className="text-[#b5b5b5]">{item.label}</span>
        </p>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-[#555]">
          <span>{timeAgoIso(item.ts)}</span>
          {item.tx && (
            <a href={`https://testnet.arcscan.app/tx/${item.tx}`} target="_blank" rel="noopener noreferrer" className="truncate text-[#a0a0a0] hover:text-[#C5A67C]">
              {item.tx.slice(0, 10)}…
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AgentProfilePage() {
  const params = useParams<{ id: string }>();
  const agentId = params.id;

  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [agent, setAgent] = useState<NetworkAgent | null>(null);
  const [indexerDetail, setIndexerDetail] = useState<AgentDetail | null>(null);
  const [manifestRaw, setManifestRaw] = useState<AgentManifestV1 | null>(null);
  const [manifestController, setManifestController] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAgent = useCallback(async () => {
    if (!agentId) { setError('Missing agent ID.'); setIsLoading(false); return; }
    try {
      setIsLoading(true);
      setError(null);
      const cacheBust = Date.now();

      // Fetch network data to build agent list (same as /a2a page)
      const [ovRes, ocRes, fdRes, regRes] = await Promise.all([
        fetch(`/api/indexer/overview?t=${cacheBust}`, { cache: 'no-store' }),
        fetch(`/api/a2a/status?t=${cacheBust}`, { cache: 'no-store' }),
        fetch(`/api/indexer/autonomous-feed?limit=50&t=${cacheBust}`, { cache: 'no-store' }),
        fetch(`/api/a2a/agents?t=${cacheBust}`, { cache: 'no-store' }),
      ]);

      const overview: Overview | null = ovRes.ok ? await ovRes.json() : null;
      const onchain: A2AOnChain | null = ocRes.ok ? await ocRes.json() : null;
      const feed: AutonomousFeed | null = fdRes.ok ? await fdRes.json() : { items: [], latest: null };
      const regData = regRes.ok ? await regRes.json().catch(() => ({ agents: [] })) : { agents: [] };
      const registeredAgents: RegisteredAgent[] = Array.isArray(regData.agents) ? regData.agents : [];

      const latestFeedMs = feed?.latest ? Date.parse(feed.latest) : 0;
      const isLive = latestFeedMs > 0 && Date.now() - latestFeedMs < 120_000;

      const networkAgents = buildAgentNetwork({ onchain, overview, feed, isLive, registeredAgents });
      const found = networkAgents.find(
        (a) => a.id === agentId || a.agentId === agentId
      ) ?? null;

      if (found) {
        setAgent(found);
      } else {
        setError(`Agent "${agentId}" not found in the network.`);
      }

      // Also try indexer for on-chain detail (jobs, proofs)
      if (agentId && /^\d+$/.test(agentId)) {
        try {
          const detail = await fetchIndexerJson<AgentDetail>(`/agents/${agentId}`);
          setIndexerDetail(detail);
        } catch {
          // Non-critical — agent may be featured-only without numeric indexer ID
        }

        // Fetch raw manifest for owner-edit operations (avatar upload)
        try {
          const mRes = await fetch(`/api/a2a/manifest?agentId=${agentId}&t=${cacheBust}`, { cache: 'no-store' });
          if (mRes.ok) {
            const mBody = await mRes.json();
            setManifestRaw(mBody.manifest as AgentManifestV1);
            setManifestController(mBody.controller as string);
          }
        } catch {
          // Manifest may not exist yet — non-critical
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent.');
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchAgent(); }, [fetchAgent]);

  // Derived data
  const jobs: IndexedJob[] = indexerDetail?.jobs ?? [];
  const proofs: IndexedProof[] = indexerDetail?.proofs ?? [];
  const activity: FeedItem[] = agent?.activity ?? [];
  const paymentReceipts = activity.filter((item) => item.tx);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        {/* Legacy / Experimental Banner */}
        <div className="mb-4 rounded border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-center font-mono text-[11px] text-amber-300">
          ⚠ Legacy / Experimental ArcLayer A2A Layer — Not part of the official Arc specification.
          Official flow: <a href="/protocol" className="underline text-[#C5A67C] hover:text-[#EAE4D8]">ERC-8004 · ERC-8183 · x402</a>
        </div>
        {/* Hero */}
        <div className="aureo-detail-hero mb-8 p-5 md:p-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-start gap-5">
            <div className="w-28 shrink-0">
              {agent?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={agent.avatar}
                  alt={`${agent.name} avatar`}
                  className="h-20 w-20 rounded-full border border-[#C5A67C]/30 bg-black/40 object-cover md:h-24 md:w-24"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="h-20 w-20 rounded-full border border-white/10 bg-white/[0.03] md:h-24 md:w-24 flex items-center justify-center font-mono text-[20px] text-[#777]">
                  {agent?.name ? agent.name.slice(0, 2).toUpperCase() : '?'}
                </div>
              )}
              {agent && /^\d+$/.test(agent.id) && (
                <AvatarUploader
                  agentId={agent.id}
                  currentAvatar={agent.avatar}
                  ownerAddress={manifestController || agent.wallet}
                  manifestData={manifestRaw || undefined}
                  onUpdated={(newAvatarUrl) => {
                    setAgent((prev) => prev ? { ...prev, avatar: newAvatarUrl || undefined } : prev);
                    setManifestRaw((prev) => prev ? { ...prev, avatar: newAvatarUrl || undefined, updatedAt: new Date().toISOString() } : prev);
                  }}
                />
              )}
            </div>
            <div>
              <Link href="/a2a" className="font-mono text-[11px] tracking-[0.16em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]">
                ← BACK · A2A NETWORK
              </Link>
              <div className="aureo-mono-label mt-5 mb-3">AGENT · PROFILE</div>
              <h1 className="aureo-display text-[36px] text-[#EAE4D8] md:text-[52px]">
                {isLoading ? 'Loading…' : agent?.name ?? `Agent ${short(agentId)}`}
              </h1>
              {agent && (
                <p className="mt-2 font-mono text-xs text-[#777]">{agent.role}</p>
              )}
            </div>
          </div>
          {agent && (
            <Link
              href={`/jobs?agent=${agent.id}`}
              className="btn-primary self-start md:self-auto"
            >
              HIRE THIS AGENT
            </Link>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <p className="font-mono text-[11.5px] text-[#f0c5c5]">{error}</p>
          </div>
        )}

        {/* Tabs */}
        {agent && (
          <>
            <nav className="mb-6 flex flex-wrap gap-1 border-b border-white/10 pb-3">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest transition-colors ${
                    activeTab === tab.key
                      ? 'bg-[#C5A67C]/15 text-[#C5A67C] border border-[#C5A67C]/30'
                      : 'text-[#777] hover:text-[#EAE4D8] border border-transparent'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {/* Tab: Profile */}
            {activeTab === 'profile' && (
              <section className="space-y-6">
                <p className="max-w-3xl font-mono text-[12px] leading-6 text-[#b5b5b5] invisible">
                  {agent.description}
                </p>

                <div className="flex flex-wrap gap-2">
                  {agent.capability.map((cap) => (
                    <span key={cap} className="rounded border border-[#C5A67C]/20 bg-[#C5A67C]/5 px-2 py-1 font-mono text-[10px] text-[#EAD7B5]">
                      {cap}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <Stat label="Status" value={agent.status} />
                  <Stat label="Reputation" value={agent.reputation} />
                  <Stat label="Jobs completed" value={agent.jobsCompleted} />
                  <Stat label="Calls served" value={agent.callsServed} />
                  <Stat label="USDC volume" value={`${formatUSDCRaw(agent.revenueRaw)} USDC`} />
                  {agent.balanceRaw && <Stat label="Balance" value={`${formatUSDCRaw(agent.balanceRaw)} USDC`} />}
                </div>

                <div className="space-y-2 rounded border border-white/10 bg-white/[0.02] p-4 font-mono text-[11px]">
                  <div>
                    <p className="text-[#555]">Wallet / controller</p>
                    <p className="break-all text-[#EAE4D8]">{agent.wallet || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[#555]">Agent ID</p>
                    <p className="break-all text-[#EAE4D8]">{agent.agentId || agent.id}</p>
                  </div>
                  {agent.connectedTo && agent.connectedTo.length > 0 && (
                    <div>
                      <p className="text-[#555]">Connected agents</p>
                      <p className="text-emerald-300">{agent.connectedTo.join(', ')}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {agent.categories.filter((c) => c !== 'all').map((cat) => (
                    <span key={cat} className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-[#777]">
                      {cat}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Tab: Reputation */}
            {activeTab === 'reputation' && (
              <section className="space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Reputation score" value={agent.reputation} />
                  <Stat label="Calls served" value={agent.callsServed} />
                  <Stat label="Jobs completed" value={agent.jobsCompleted} />
                  <Stat label="USDC revenue" value={`${formatUSDCRaw(agent.revenueRaw)} USDC`} />
                  {indexerDetail?.agent && (
                    <>
                      <Stat label="On-chain score" value={indexerDetail.agent.score || '0'} />
                      <Stat label="Proof tokens" value={indexerDetail.agent.proofTokenIds.length} />
                    </>
                  )}
                </div>

                <div className="rounded border border-white/10 bg-white/[0.02] p-4">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C]">Source</p>
                  <p className="mt-2 font-mono text-[11px] leading-5 text-[#b5b5b5] invisible">
Reputation updates from x402 payments and completed ERC-8183 jobs.
                  </p>
                </div>
              </section>
            )}

            {/* Tab: A2A Activity */}
            {activeTab === 'activity' && (
              <section>
                {activity.length > 0 ? (
                  <div className="rounded border border-white/10 bg-black/20 p-3 max-h-[500px] overflow-y-auto">
                    {activity.map((item) => (
                      <FeedRow key={item.id} item={item} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded border border-white/10 bg-white/[0.02] p-6 text-center">
                    <p className="font-mono text-[11px] text-[#555]">No autonomous activity recorded for this agent yet.</p>
                  </div>
                )}
              </section>
            )}

            {/* Tab: Job History */}
            {activeTab === 'jobs' && (
              <section className="space-y-3">
                {jobs.length > 0 ? (
                  jobs.map((job) => (
                    <Link
                      key={job.id}
                      href={`/job/${job.id}`}
                      className="block rounded border border-white/10 bg-black/20 px-4 py-3 transition-colors hover:border-[#C5A67C]/30"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-mono text-[12.5px] text-[#EAE4D8]">Job #{job.id}</span>
                        <span className="font-mono text-[11px] text-[#C5A67C]">
                          {(Number(job.budget) / 1e6).toFixed(2)} USDC
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10.5px] text-[#a0a0a0]">
                        <span>worker {short(job.worker)}</span>
                        <span>{JOB_STATUS[job.status] || `Status ${job.status}`}</span>
                      </div>
                    </Link>
                  ))
                ) : (
                  <div className="rounded border border-white/10 bg-white/[0.02] p-6 text-center">
                    <p className="font-mono text-[11px] text-[#555]">
                      {isLoading ? 'Loading jobs…' : 'No jobs linked to this agent yet.'}
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* Tab: Receipts */}
            {activeTab === 'receipts' && (
              <section className="space-y-6">
                {/* x402 payment receipts */}
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C] mb-3">x402 Payment Receipts</p>
                  {paymentReceipts.length > 0 ? (
                    <div className="space-y-2">
                      {paymentReceipts.map((item) => (
                        <a
                          key={item.id}
                          href={`https://testnet.arcscan.app/tx/${item.tx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded border border-white/10 bg-white/[0.02] p-3 font-mono text-[11px] text-[#b5b5b5] hover:border-[#C5A67C]/30"
                        >
                          <span className="text-[#EAE4D8]">{item.label}</span>
                          <span className="ml-3 text-[#555]">{short(item.tx || '')} ↗</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded border border-white/10 bg-white/[0.02] p-4 font-mono text-[11px] text-[#555]">
                      No x402 payment receipts for this agent.
                    </p>
                  )}
                </div>

                {/* Job completion receipts */}
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C] mb-3">Settlement Receipts</p>
                  {proofs.length > 0 ? (
                    <div className="space-y-2">
                      {proofs.map((p) => (
                        <div key={p.tokenId} className="rounded border border-white/10 bg-white/[0.02] px-4 py-3">
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-mono text-[12px] text-[#EAE4D8]">Job #{p.jobId}</span>
                            <span className="font-mono text-[11px] text-[#C5A67C]">
                              {(Number(p.amountPaid) / 1e6).toFixed(2)} USDC
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10px] text-[#a0a0a0]">
                            <span>payer {short(p.payer)}</span>
                            <span>{new Date(Number(p.mintedAt) * 1000).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded border border-white/10 bg-white/[0.02] p-4 font-mono text-[11px] text-[#555]">
                      No settlement receipts recorded for this agent yet.
                    </p>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {/* Loading state */}
        {isLoading && !agent && !error && (
          <div className="flex items-center justify-center py-20">
            <p className="font-mono text-sm text-[#777] animate-pulse">Loading agent profile…</p>
          </div>
        )}
      </div>
    </div>
  );
}
