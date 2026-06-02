'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────

type PublicWorkerSummary = {
  localJobId: string;
  erc8183JobId: string | null;
  lifecycleStatus: string;
  status: string;
  budget: string | null;
  createdAt: string;
  expiredAtUnix: string | null;
  shortDescription: string | null;
  createTxHash: string | null;
  inputPayloadHash: string;
};

type PrivateJobSummary = PublicWorkerSummary & {
  buyerAgentId: string;
  providerAgentId: string | null;
  evaluatorAgentId: string | null;
  buyerController: string | null;
  providerController: string | null;
  evaluatorController: string | null;
  nextAction: string | null;
};

type ByAgentResponse = {
  ok: boolean;
  agentId: string;
  isOwner: boolean;
  asWorkerPublic: PublicWorkerSummary[];
  asClient: PrivateJobSummary[];
  asWorker: PrivateJobSummary[];
  asEvaluator: PrivateJobSummary[];
  error?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBudget(atomic: string | null): string {
  if (!atomic) return 'Budget not set';
  try {
    const val = BigInt(atomic);
    return `$${(Number(val) / 1_000_000).toFixed(2)} USDC`;
  } catch {
    return 'Budget not set';
  }
}

function statusPillColor(ls: string): string {
  switch (ls) {
    case 'Completed':
    case 'Settled':
      return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300';
    case 'Funded':
    case 'Running':
    case 'Claimed':
      return 'border-[#F3C536]/25 bg-[#F3C536]/10 text-[#F3C536]';
    case 'Submitted':
      return 'border-blue-400/25 bg-blue-400/10 text-blue-300';
    case 'Rejected':
    case 'Expired':
      return 'border-red-400/25 bg-red-400/10 text-red-300';
    default:
      return 'border-white/15 bg-white/5 text-[#EAE4D8]/60';
  }
}

function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

// ── Job Card ──────────────────────────────────────────────────────────────

function JobCard({
  job,
  roleLabel,
}: {
  job: PublicWorkerSummary | PrivateJobSummary;
  roleLabel: string;
}) {
  const nextAction =
    'nextAction' in job ? (job as PrivateJobSummary).nextAction : null;

  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.06] py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-[#EAE4D8]/55">
            #{job.localJobId}
          </span>
          <span
            className={`inline-flex rounded-md border px-2 py-0.5 font-mono text-[10px] ${statusPillColor(job.lifecycleStatus)}`}
          >
            {job.lifecycleStatus}
          </span>
          <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-[#EAE4D8]/45">
            {roleLabel}
          </span>
        </div>

        {job.shortDescription && (
          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[#EAE4D8]/70">
            {job.shortDescription}
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#EAE4D8]/45">
          <span>{formatBudget(job.budget)}</span>
          <span>Created {shortDate(job.createdAt)}</span>
          {job.expiredAtUnix && (
            <span>
              Expires{' '}
              {shortDate(new Date(Number(job.expiredAtUnix) * 1000).toISOString())}
            </span>
          )}
          {nextAction && (
            <span className="text-[#F3C536]/70">→ {nextAction}</span>
          )}
        </div>
      </div>

      <Link
        href={`/erc8183-jobs/${job.localJobId}`}
        className="mt-2 inline-flex shrink-0 items-center rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[12px] font-medium text-[#EAE4D8]/70 transition hover:border-[#F3C536]/30 hover:text-[#F3C536] sm:mt-0"
      >
        View Job
      </Link>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────

function JobGroup({
  title,
  jobs,
  roleLabel,
}: {
  title: string;
  jobs: (PublicWorkerSummary | PrivateJobSummary)[];
  roleLabel: string;
}) {
  if (jobs.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#F3C536]">
        {title}
      </h3>
      <div className="rounded-xl border border-white/[0.08] bg-[#080D13]/60 px-5">
        {jobs.map((job) => (
          <JobCard key={job.localJobId} job={job} roleLabel={roleLabel} />
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────

export function AgentJobsSection({ agentId }: { agentId: string }) {
  const [data, setData] = useState<ByAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/erc8183-jobs/by-agent/${agentId}`);
      const json = (await res.json()) as ByAgentResponse;
      if (json.ok) {
        setData(json);
        setError(null);
      } else {
        setError(json.error || 'Failed to load jobs');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchData();

    // Light polling: 30s, pause when hidden
    const startPolling = () => {
      intervalRef.current = setInterval(() => {
        if (!document.hidden) fetchData();
      }, 30_000);
    };

    startPolling();

    const onVisibility = () => {
      if (!document.hidden) fetchData();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="font-mono text-[12px] text-[#EAE4D8]/40">
          Loading jobs…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-950/10 px-5 py-4 text-[13px] text-red-300">
        {error}
      </div>
    );
  }

  if (!data) return null;

  // Owner view: grouped private lists
  if (data.isOwner) {
    const total =
      data.asClient.length +
      data.asWorker.length +
      data.asEvaluator.length;

    if (total === 0) {
      return (
        <div className="py-8 text-center font-mono text-[12px] text-[#EAE4D8]/40">
          No ERC-8183 jobs found for this agent.
        </div>
      );
    }

    return (
      <div>
        <JobGroup
          title="Jobs as Client"
          jobs={data.asClient}
          roleLabel="Client"
        />
        <JobGroup
          title="Jobs as Worker"
          jobs={data.asWorker}
          roleLabel="Worker"
        />
        <JobGroup
          title="Jobs as Evaluator"
          jobs={data.asEvaluator}
          roleLabel="Evaluator"
        />
      </div>
    );
  }

  // Public view: worker proof only
  if (data.asWorkerPublic.length === 0) {
    return (
      <div className="py-8 text-center font-mono text-[12px] text-[#EAE4D8]/40">
        No job history available for this agent.
      </div>
    );
  }

  return (
    <div>
      <JobGroup
        title="Jobs assigned to this agent"
        jobs={data.asWorkerPublic}
        roleLabel="Worker"
      />
    </div>
  );
}
