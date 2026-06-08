'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';
import { useArcWallet } from '@/hooks/useArcWallet';
import { formatUSDC } from '@/lib/contracts';
import { IndexerDegradedBanner } from '@/components/IndexerDegradedBanner';
import { loadAgentDetail, type DataSource } from '@/lib/indexer';
import { AgentApiKeysSection } from '@/components/agent/AgentApiKeysSection';
import { AgentJobsSection } from '@/components/agent/AgentJobsSection';
import {
  displayCategory,
  fetchErc8183Metadata,
  getErc8183Avatar,
  getErc8183Capabilities,
  getErc8183Links,
  isErc8183ProfileMetadata,
  roleLabel,
  shortText,
  type Erc8183AgentMetadata,
} from '@/lib/erc8183/agent-profile';
import type { DashboardAgentRow } from '@/lib/dashboard/erc8183-agents';
import { BotStatusPill, isValidAgentId } from '@/components/agent/BotStatusPill';
import {
  BadgeCheck,
  ShieldCheck,
  Link2,
  Trophy,
  FileJson,
  Sparkles,
  Code2,
  Key,
  Briefcase,
} from 'lucide-react';

// ─── Reputation overlay type ───────────────────────────────────────

type ReputationOverlay = {
  averageScore: string;
  feedbackCount: number;
  latestScore: string | null;
};

// ─── Types ──────────────────────────────────────────────────────────

type IndexedJob = {
  id: string;
  agentId: string;
  client: string;
  worker: string;
  provider: string;
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

type AgentTab =
  | 'basic'
  | 'capabilities'
  | 'links'
  | 'reputation'
  | 'metadata'
  | 'actions'
  | 'api-keys'
  | 'jobs';

const AGENT_TABS: readonly [
  AgentTab,
  string,
  ComponentType<{ className?: string }>,
][] = [
  ['basic', 'Basic Info', BadgeCheck],
  ['capabilities', 'Capabilities', ShieldCheck],
  ['links', 'Links', Link2],
  ['reputation', 'Reputation', Trophy],
  ['metadata', 'Metadata', FileJson],
  ['actions', 'Actions', Sparkles],
  ['jobs', 'Jobs', Briefcase],
  ['api-keys', 'API Keys', Key],
];

// ─── Helpers ────────────────────────────────────────────────────────

function parseAgentId(value: string | undefined) {
  return value && /^\d+$/.test(value) ? value : null;
}

function buildReputationSeries(
  agent: IndexedAgent | undefined,
  jobs: IndexedJob[],
  proofs: IndexedProof[],
  reputation: ReputationOverlay | null,
  dashboardReputation?: string,
) {
  const baseScore = Number(reputation?.averageScore ?? dashboardReputation ?? agent?.score ?? 0);
  const reputationScore = Number(reputation?.averageScore ?? dashboardReputation ?? agent?.reputationScore ?? baseScore);
  const completedJobs = jobs.filter(
    (job) => job.approved || job.status >= 3,
  ).length;
  const proofBoost = proofs.length * 2;
  const seed = Math.max(0, reputationScore - completedJobs - proofBoost);
  return [
    seed,
    seed + Math.ceil(completedJobs / 2),
    seed + completedJobs,
    Math.max(baseScore, reputationScore) + proofBoost,
  ];
}

function isValidDateString(value?: string | null): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time);
}

function formatDateString(value?: string | null): string | null {
  if (!isValidDateString(value)) return null;
  return new Date(value as string).toLocaleString();
}

function formatRegisteredAt(
  rawRegisteredAt?: string | null,
  metadata?: Erc8183AgentMetadata | null,
): { label: string; value: string } {
  const meta = metadata as Record<string, unknown> | null | undefined;
  const metadataDate =
    formatDateString(meta?.createdAt as string | undefined) ||
    formatDateString(meta?.updatedAt as string | undefined);

  if (metadataDate) {
    return { label: 'Registered', value: metadataDate };
  }

  const raw = String(rawRegisteredAt || '').trim();
  if (!raw) return { label: 'Registered', value: '—' };

  const numeric = Number(raw);

  if (
    Number.isFinite(numeric) &&
    numeric >= 946684800 &&
    numeric <= 4102444800
  ) {
    return {
      label: 'Registered',
      value: new Date(numeric * 1000).toLocaleString(),
    };
  }

  if (
    Number.isFinite(numeric) &&
    numeric >= 946684800000 &&
    numeric <= 4102444800000
  ) {
    return {
      label: 'Registered',
      value: new Date(numeric).toLocaleString(),
    };
  }

  return { label: 'Registered Block', value: `#${raw}` };
}

// ─── Sub-components ─────────────────────────────────────────────────

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
    <svg
      viewBox="0 0 100 100"
      className="h-20 w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient
          id="sparkFill"
          x1="0"
          y1="0"
          x2="0"
          y2="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#F3C536" stopOpacity="0.35" />
          <stop offset="1" stopColor="#F3C536" stopOpacity="0" />
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
        stroke="#F3C536"
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

function Erc8183Avatar({
  avatar,
  name,
}: {
  avatar?: string;
  name: string;
}) {
  if (avatar) {
    return (
      <div className="h-[160px] w-[160px] overflow-hidden rounded-full border border-[#F3C536]/30 bg-black/30 shadow-[0_0_44px_rgba(243,197,54,0.12)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatar} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div className="relative flex h-[160px] w-[160px] items-center justify-center overflow-hidden rounded-full border border-[#F3C536]/30 bg-[#0B0F14] shadow-[0_0_44px_rgba(243,197,54,0.12)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(243,197,54,0.18),transparent_42%)]" />
      <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-[#F3C536]/35 text-[28px] font-semibold text-[#F3C536]">
        {name.slice(0, 1).toUpperCase()}
      </div>
      <div className="absolute bottom-8 h-1 w-9 rounded-full bg-[#F3C536]/80 shadow-[0_0_16px_rgba(243,197,54,0.7)]" />
    </div>
  );
}

function AgentTabButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'relative inline-flex items-center gap-2 px-5 py-4 text-[14px] font-medium text-[#F3C536]'
          : 'inline-flex items-center gap-2 px-5 py-4 text-[14px] font-medium text-[#EAE4D8]/55 transition hover:text-[#F3C536]'
      }
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {active && (
        <span className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full bg-[#F3C536] shadow-[0_0_16px_rgba(243,197,54,0.55)]" />
      )}
    </button>
  );
}

function DetailRow({
  label,
  value,
  copy,
}: {
  label: string;
  value: React.ReactNode;
  copy?: string;
}) {
  return (
    <div className="grid gap-2 border-b border-white/[0.06] py-4 last:border-b-0 sm:grid-cols-[150px_1fr_32px] sm:items-center">
      <div className="text-[13px] text-[#EAE4D8]/55">{label}</div>
      <div className="min-w-0 truncate font-mono text-[12px] text-[#F5F0E5]">
        {value || '—'}
      </div>
      {copy ? (
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(copy)}
          className="hidden h-8 w-8 items-center justify-center rounded border border-white/10 text-[10px] text-[#EAE4D8]/45 transition hover:border-[#F3C536]/40 hover:text-[#F3C536] sm:flex"
        >
          CP
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function CapabilityPill({ value }: { value: string }) {
  return (
    <span className="rounded-md border border-[#F3C536]/20 bg-[#F3C536]/7 px-3 py-2 font-mono text-[11px] text-[#F3C536]">
      {value}
    </span>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function AgentProfilePage() {
  const params = useParams<{ id: string }>();
  const { address, isConnected } = useArcWallet();
  const agentId = parseAgentId(params.id);

  const [profile, setProfile] = useState<AgentDetail | null>(null);
  const [metadata, setMetadata] = useState<Erc8183AgentMetadata | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>('indexer');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AgentTab>('basic');
  const [showMetadataJson, setShowMetadataJson] = useState(false);

  const [dashboardAgent, setDashboardAgent] = useState<DashboardAgentRow | null>(null);
  const [reputation, setReputation] = useState<ReputationOverlay | null>(null);

  // ─── Load agent detail + resolve metadata ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!agentId) {
        setError('Invalid agent id.');
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);
        const { data, source } = await loadAgentDetail(agentId);
        const resolvedMetadata = await fetchErc8183Metadata(
          data.agent.metadataURI,
        );

        // Fetch dashboard row as trusted ERC-8183 fallback.
        // Dashboard already filters via /api/dashboard/erc8183-agents.
        let dashboardRow: DashboardAgentRow | null = null;
        try {
          const dashRes = await fetch('/api/dashboard/erc8183-agents', {
            cache: 'no-store',
            headers: { accept: 'application/json' },
          });
          if (dashRes.ok) {
            const dashData = await dashRes.json();
            const rows: DashboardAgentRow[] = Array.isArray(dashData?.agents)
              ? dashData.agents
              : [];
            dashboardRow =
              rows.find(
                (r) =>
                  r.tokenId === agentId ||
                  r.id === agentId ||
                  r.profileHref === `/agent/${agentId}`,
              ) || null;
          }
        } catch {
          // Dashboard fetch is non-blocking fallback.
        }

        // Fetch reputation from /api/a2a/reputation overlay.
        // No-store: always fresh. Failure is non-blocking.
        let repOverlay: ReputationOverlay | null = null;
        try {
          const repRes = await fetch(
            `/api/a2a/reputation/${encodeURIComponent(agentId)}`,
            { cache: 'no-store' },
          );
          if (repRes.ok) {
            const repJson = await repRes.json();
            // Shape A (envelope): repJson.reputation.score
            // Shape B (raw indexer): repJson.averageScore
            // Fallback: repJson.score
            const resolvedScore = String(repJson?.reputation?.score ?? repJson?.averageScore ?? repJson?.score ?? '0');
            const resolvedFeedbackCount = Number(repJson?.reputation?.stats?.callsServed ?? repJson?.feedbackCount ?? repJson?.stats?.callsServed ?? 0);
            const resolvedLatestScore = repJson?.reputation?.feedback?.[0]?.score ?? repJson?.latestScore ?? null;
            // Only overlay when the endpoint returned actual reputation data.
            // The route returns HTTP 200 with score='0' and stats=null when
            // the agent has no reputation row — don't let that clobber a
            // nonzero score from /agents/{id}.
            if (Number(resolvedScore) > 0 || resolvedFeedbackCount > 0) {
              repOverlay = {
                averageScore: resolvedScore,
                feedbackCount: resolvedFeedbackCount,
                latestScore: resolvedLatestScore,
              };
            }
          }
        } catch {
          // Reputation fetch is non-blocking.
        }

        if (!cancelled) {
          setProfile(data);
          setMetadata(resolvedMetadata);
          setDashboardAgent(dashboardRow);
          setReputation(repOverlay);
          setDataSource(source);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'Failed to load agent profile.',
          );
          setProfile(null);
          setMetadata(null);
          setDashboardAgent(null);
          setReputation(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // ─── Computed values ───────────────────────────────────────────────
  const agent = profile?.agent;
  const jobs = profile?.jobs || [];
  const proofs = profile?.proofs || [];
  const series = buildReputationSeries(agent, jobs, proofs, reputation, dashboardAgent?.reputation);

  // Computed ERC-8183 score: dashboard → overlay → indexer → '0'
  const computedScore =
    dashboardAgent?.reputation ||
    reputation?.averageScore ||
    agent?.reputationScore ||
    agent?.score ||
    '0';

  const capabilities = getErc8183Capabilities(metadata);
  const links = getErc8183Links(metadata);
  const avatar = getErc8183Avatar(metadata);

  const displayName =
    metadata?.name || dashboardAgent?.title || `Agent #${agentId || '0'}`;
  const displayRole = roleLabel(metadata?.role || 'Worker');
  const category =
    displayCategory(metadata) || dashboardAgent?.category || 'ERC-8183 Commerce';

  const displayDescription =
    metadata?.description ||
    dashboardAgent?.description ||
    'ERC-8183 commerce agent for escrow-backed work, reputation, and settlement history.';

  // ERC-8183 detection: dashboard shortcut OR metadata marker.
  // Metadata marker (erc8183, agentic-commerce, etc.) is authoritative —
  // if the agent declared ERC-8183 compliance at registration, it IS ERC-8183.
  // Capabilities are optional enrichment (what the agent can DO), not a gate.
  const isErc8183Agent =
    Boolean(agent) &&
    (Boolean(dashboardAgent) || isErc8183ProfileMetadata(metadata));

  const isOwner =
    isConnected &&
    Boolean(address) &&
    Boolean(agent?.controller) &&
    address?.toLowerCase() === agent?.controller?.toLowerCase();

  const visibleTabs = isOwner
    ? AGENT_TABS
    : AGENT_TABS.filter(([key]) => key !== 'api-keys');

  const registeredInfo = formatRegisteredAt(agent?.registeredAt, metadata);

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[#05070A] text-[#F5F0E5]">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(243,197,54,0.06),transparent_28%),radial-gradient(circle_at_80%_8%,rgba(255,255,255,0.035),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_46%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:44px_44px]" />

      <section className="relative mx-auto max-w-[1280px] px-6 pb-16 pt-10 sm:px-10 lg:px-16">
        {/* Back link */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link
            href="/dashboard"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] transition hover:text-[#F5F0E5]"
          >
            ← Back to Dashboard
          </Link>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/25 bg-red-950/10 px-5 py-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Indexer degraded banner */}
        <IndexerDegradedBanner
          visible={dataSource === 'rpc'}
          className="mb-6"
        />

        {/* Loading / Not found / Unsupported / Profile */}
        {isLoading ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-white/10 bg-[#080D13]/70">
            <div className="font-mono text-[12px] text-[#EAE4D8]/55">
              Loading ERC-8183 agent profile...
            </div>
          </div>
        ) : !agent ? (
          <div className="rounded-xl border border-[#F3C536]/24 bg-[#080D13]/78 p-10">
            <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[#F3C536]">
              Agent Not Found
            </div>
            <h1 className="mt-4 text-[32px] font-semibold tracking-[-0.04em]">
              No agent record found.
            </h1>
          </div>
        ) : !isErc8183Agent ? (
          <div className="rounded-xl border border-[#F3C536]/24 bg-[#080D13]/78 p-10">
            <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[#F3C536]">
              Unsupported Agent Type
            </div>
            <h1 className="mt-4 text-[32px] font-semibold tracking-[-0.04em]">
              This is not an ERC-8183 commerce agent.
            </h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#EAE4D8]/58">
              Dashboard profiles are currently limited to ERC-8183 job, escrow,
              and commerce agents.
            </p>
          </div>
        ) : (
          <>
            {/* ─── Hero card ──────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-xl border border-[#1A2228] bg-[#080D13]/78 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]">
              <div className="relative grid min-h-[300px] gap-8 p-8 md:grid-cols-[230px_1fr]">
                <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(circle_at_85%_15%,rgba(243,197,54,0.16),transparent_28%),linear-gradient(135deg,transparent_40%,rgba(243,197,54,0.10)_70%,transparent_100%)]" />

                <div className="relative flex items-center justify-center">
                  <Erc8183Avatar avatar={avatar} name={displayName} />
                </div>

                <div className="relative flex flex-col justify-center">
                  <div className="flex flex-wrap items-center gap-4">
                    <h1 className="text-[38px] font-semibold tracking-[-0.045em] text-[#F5F0E5]">
                      {displayName}
                    </h1>
                    <span className="inline-flex items-center gap-2 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[14px] text-emerald-300">
                      Minted
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-md border border-[#F3C536]/25 bg-[#F3C536]/8 px-3 py-1.5 text-[14px] text-[#F3C536]">
                      ERC-8183 Commerce
                    </span>
                    {isValidAgentId(String(agentId)) && <BotStatusPill agentId={String(agentId)} />}
                  </div>

                  <p className="mt-3 max-w-2xl text-[14px] leading-6 text-[#EAE4D8]/55">
                    {displayDescription}
                  </p>

                  <div className="mt-8 grid max-w-[760px] gap-4 text-[15px] md:grid-cols-[150px_1fr]">
                    <div className="text-[#F3C536]">Agent ID:</div>
                    <div>{agentId}</div>

                    <div className="text-[#F3C536]">Role:</div>
                    <div>{displayRole}</div>

                    <div className="text-[#F3C536]">Category:</div>
                    <div>{category}</div>

                    <div className="text-[#F3C536]">Capabilities:</div>
                    <div className="truncate">
                      {capabilities.length > 0
                        ? capabilities.slice(0, 5).join(', ')
                        : '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ─── Tabs ──────────────────────────────────────────────── */}
            <div className="mt-8 overflow-hidden rounded-xl border border-[#1A2228] bg-[#080D13]/78">
              <div className="flex overflow-x-auto border-b border-white/[0.08]">
                {visibleTabs.map(([key, label, Icon]) => (
                  <AgentTabButton
                    key={key}
                    active={activeTab === key}
                    label={label}
                    icon={Icon}
                    onClick={() => setActiveTab(key)}
                  />
                ))}
              </div>

              <div className="p-6">
                {/* Basic Info */}
                {activeTab === 'basic' && (
                  <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                    <div>
                      <DetailRow
                        label="Agent ID"
                        value={String(agentId || '—')}
                      />
                      <DetailRow label="Role" value={displayRole} />
                      <DetailRow
                        label="Controller"
                        value={shortText(agent.controller)}
                        copy={agent.controller}
                      />
                      <DetailRow
                        label="Skill Hash"
                        value={shortText(agent.skillHash, 10, 8)}
                        copy={agent.skillHash}
                      />
                      <DetailRow
                        label="Metadata URI"
                        value={shortText(agent.metadataURI, 18, 10)}
                        copy={agent.metadataURI}
                      />
                      <DetailRow
                        label={registeredInfo.label}
                        value={registeredInfo.value}
                      />
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-5">
                      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                        Protocol Signals
                      </div>
                      <div className="mt-5 grid gap-3">
                        {(
                          [
                            ['Score', computedScore],
                            ['Feedback', String(reputation?.feedbackCount ?? 0)],
                            ['Jobs', String(jobs.length)],
                            ['Proofs', String(proofs.length)],
                          ] as const
                        ).map(([label, value]) => (
                          <div
                            key={label}
                            className="rounded-lg border border-white/10 bg-black/20 p-4"
                          >
                            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/45">
                              {label}
                            </div>
                            <div className="mt-2 text-[26px] text-[#F5F0E5]">
                              {value}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Capabilities */}
                {activeTab === 'capabilities' && (
                  <div>
                    <h2 className="text-[22px] font-semibold text-[#F5F0E5]">
                      Capabilities
                    </h2>
                    <div className="mt-5 flex flex-wrap gap-3">
                      {capabilities.length > 0 ? (
                        capabilities.map((capability) => (
                          <CapabilityPill
                            key={capability}
                            value={capability}
                          />
                        ))
                      ) : (
                        <p className="text-sm text-[#EAE4D8]/55">
                          No capabilities found in metadata.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Links */}
                {activeTab === 'links' && (
                  <div>
                    <h2 className="text-[22px] font-semibold text-[#F5F0E5]">
                      Links
                    </h2>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      {(
                        [
                          ['Website', links.website],
                          ['Docs', links.docs],
                          ['Repo', links.repo],
                          ['X', links.x],
                        ] as const
                      ).map(([label, href]) =>
                        href ? (
                          <a
                            key={label}
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#EAE4D8]/70 transition hover:border-[#F3C536]/35 hover:text-[#F3C536]"
                          >
                            {label}
                          </a>
                        ) : null,
                      )}
                    </div>
                  </div>
                )}

                {/* Reputation */}
                {activeTab === 'reputation' && (
                  <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-5">
                      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                        Reputation Trend
                      </div>
                      <div className="mt-4">
                        <Sparkline values={series} />
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-5">
                      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                        Jobs &amp; Proofs
                      </div>
                      <div className="mt-4 space-y-3 text-sm text-[#EAE4D8]/62">
                        <p>Linked jobs: {jobs.length}</p>
                        <p>Settlement proofs: {proofs.length}</p>
                        <p>
                          Reputation score:{' '}
                          {computedScore}
                        </p>
                        {reputation?.feedbackCount != null && reputation.feedbackCount > 0 && (
                          <p>Feedback count: {reputation.feedbackCount}</p>
                        )}
                        {reputation?.latestScore && (
                          <p>Latest score: {reputation.latestScore}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Metadata */}
                {activeTab === 'metadata' && (
                  <section className="min-h-[260px] border-l border-white/[0.08] pl-7">
                    <div className="flex items-center gap-3">
                      <FileJson className="h-5 w-5 text-[#F3C536]" />
                      <h2 className="text-[22px] font-semibold text-[#F5F0E5]">
                        Metadata
                      </h2>
                    </div>

                    <p className="mt-3 max-w-xl text-sm leading-6 text-[#EAE4D8]/58">
                      View a summary of the agent's identity metadata.
                    </p>

                    <button
                      type="button"
                      onClick={() => setShowMetadataJson((value) => !value)}
                      className="mt-6 inline-flex h-11 items-center gap-2 rounded-md border border-[#F3C536]/35 bg-black/20 px-5 font-mono text-[12px] font-semibold text-[#F3C536] transition hover:border-[#F3C536]/60 hover:bg-[#F3C536]/8"
                    >
                      <Code2 className="h-4 w-4" />
                      {showMetadataJson ? 'Hide JSON' : 'Show JSON'}
                    </button>

                    {showMetadataJson && (
                      <pre className="mt-5 max-h-[420px] overflow-auto rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-[11px] leading-5 text-[#EAE4D8]/65">
                        {JSON.stringify(
                          metadata || { metadataURI: agent.metadataURI },
                          null,
                          2,
                        )}
                      </pre>
                    )}
                  </section>
                )}

                {/* Actions — Hire This Agent */}
                {activeTab === 'actions' && (
                  <section className="rounded-xl border border-[#C5A67C]/20 bg-black/20 p-5">
                    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                      ERC-8183 · Hire Agent
                    </div>

                    <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
                      Hire This Agent
                    </h2>

                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#EAE4D8]/52">
                      Create an ERC-8183 escrow job directly with this agent.
                      Prepare, sign on-chain, and confirm — all in one flow.
                    </p>

                    <Link
                      href={`/agent/${agentId}/escrow`}
                      className="mt-4 inline-flex h-11 items-center rounded-lg border border-[#F0B84A]/55 bg-[#F0B84A] px-6 text-sm font-semibold text-black shadow-[0_0_34px_rgba(240,184,74,0.18)] transition hover:bg-[#FFD084]"
                    >
                      Open Direct Hire →
                    </Link>
                  </section>
                )}

                {/* API Keys — owner only */}
                {activeTab === 'api-keys' && isOwner && agentId && (
                  <AgentApiKeysSection agentId={agentId} />
                )}

                {/* Jobs — public worker proof + owner private grouped */}
                {activeTab === 'jobs' && agentId && (
                  <AgentJobsSection agentId={agentId} />
                )}
              </div>
            </div>

            {/* ─── Jobs & Proofs ──────────────────────────────────────── */}
            <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
              <section className="rounded-xl border border-[#1A2228] bg-[#080D13]/78 p-6">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                  Jobs
                </div>
                <h2 className="mt-2 text-[22px] font-semibold text-[#F5F0E5]">
                  Linked jobs
                </h2>
                <div className="mt-5 space-y-3">
                  {jobs.length > 0 ? (
                    jobs.map((job) => (
                      <Link
                        key={job.id}
                        href={`/job/${job.id}`}
                        className="block rounded-lg border border-white/10 bg-black/20 px-4 py-3 transition hover:border-[#F3C536]/25"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-mono text-[12.5px] text-[#EAE4D8]">
                            Job #{job.id}
                          </span>
                          <span className="font-mono text-[11px] text-[#C5A67C]">
                            {formatUSDC(BigInt(job.budget))} USDC
                          </span>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <p className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-[#EAE4D8]/55">
                      No jobs for this agent yet.
                    </p>
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-[#1A2228] bg-[#080D13]/78 p-6">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                  Settlement Records
                </div>
                <h2 className="mt-2 text-[22px] font-semibold text-[#F5F0E5]">
                  Proof history
                </h2>
                <div className="mt-5 space-y-3">
                  {proofs.length > 0 ? (
                    proofs.map((proof) => (
                      <div
                        key={proof.tokenId}
                        className="rounded-lg border border-white/10 bg-black/20 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-mono text-[12.5px] text-[#EAE4D8]">
                            Job #{proof.jobId}
                          </span>
                          <span className="font-mono text-[11px] text-[#C5A67C]">
                            {formatUSDC(BigInt(proof.amountPaid))} USDC
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-[#EAE4D8]/55">
                      No settlement proofs yet.
                    </p>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
