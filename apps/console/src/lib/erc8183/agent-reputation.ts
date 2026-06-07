/**
 * ERC-8183 Agent Reputation — compute provider reputation from agent_jobs activity.
 *
 * Queries public.agent_jobs where settlement_mode = 'erc8183_escrow'.
 * Groups by provider_agent_id. Only provider reputation (not buyer).
 * Deterministic formula — no hardcoded values.
 */

import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export type Erc8183AgentReputation = {
  source: 'erc8183_agent_jobs';
  score: number;
  tier: 'New' | 'Excellent' | 'Reliable' | 'Emerging' | 'Unproven';
  totalJobs: number;
  completedJobs: number;
  submittedJobs: number;
  activeJobs: number;
  rejectedJobs: number;
  failedJobs: number;
  expiredJobs: number;
  totalVolumeAtomic: string;
  totalVolumeUsdc: number;
  completedLast7d: number;
  updatedAt: string;
};

type JobRow = {
  provider_agent_id: string | null;
  status: string | null;
  erc8183_status: string | null;
  price_atomic: string | null;
  complete_tx_hash: string | null;
  submit_tx_hash: string | null;
  reject_tx_hash: string | null;
  settled_at: string | null;
  submitted_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

function isCompleted(row: JobRow): boolean {
  return (
    row.erc8183_status === 'Completed' ||
    row.status === 'settled' ||
    row.complete_tx_hash !== null
  );
}

function isSubmitted(row: JobRow): boolean {
  if (isCompleted(row)) return false;
  // Exclude terminal states — a rejected job may still have submit_tx_hash set
  if (isRejected(row) || isFailed(row) || isExpired(row)) return false;
  return (
    row.status === 'submitted' ||
    row.erc8183_status === 'Submitted' ||
    row.submit_tx_hash !== null
  );
}

function isActive(row: JobRow): boolean {
  if (isCompleted(row) || isSubmitted(row)) return false;
  // Exclude terminal states
  if (isRejected(row) || isFailed(row) || isExpired(row)) return false;
  return (
    ['created', 'claimed', 'running', 'settlement_pending'].includes(row.status ?? '') ||
    ['Open', 'Funded'].includes(row.erc8183_status ?? '')
  );
}

function isRejected(row: JobRow): boolean {
  return (
    row.status === 'rejected' ||
    row.erc8183_status === 'Rejected' ||
    row.reject_tx_hash !== null
  );
}

function isFailed(row: JobRow): boolean {
  return row.status === 'failed';
}

function isExpired(row: JobRow): boolean {
  return (
    row.status === 'expired' ||
    row.erc8183_status === 'Expired'
  );
}

function computeScore(stats: {
  totalJobs: number;
  completedJobs: number;
  submittedJobs: number;
  activeJobs: number;
  rejectedJobs: number;
  failedJobs: number;
  expiredJobs: number;
  totalVolumeUsdc: number;
  completedLast7d: number;
}): { reputationScore: number; tier: Erc8183AgentReputation['tier'] } {
  const {
    totalJobs,
    completedJobs,
    submittedJobs,
    activeJobs,
    rejectedJobs,
    failedJobs,
    expiredJobs,
    totalVolumeUsdc,
    completedLast7d,
  } = stats;

  const baseScore = totalJobs > 0 ? 10 : 0;
  const completionScore = completedJobs * 12;
  const submittedScore = submittedJobs * 4;
  const activeScore = activeJobs * 1;
  const reliabilityScore = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 25) : 0;
  const volumeScore = Math.min(20, Math.floor(totalVolumeUsdc / 1));
  const recencyScore = completedLast7d > 0 ? 5 : 0;
  const penaltyScore = rejectedJobs * 8 + failedJobs * 10 + expiredJobs * 4;

  const rawScore =
    baseScore +
    completionScore +
    submittedScore +
    activeScore +
    reliabilityScore +
    volumeScore +
    recencyScore -
    penaltyScore;

  const reputationScore = Math.max(0, Math.min(100, rawScore));

  let tier: Erc8183AgentReputation['tier'];
  if (totalJobs === 0) tier = 'New';
  else if (reputationScore >= 80) tier = 'Excellent';
  else if (reputationScore >= 60) tier = 'Reliable';
  else if (reputationScore >= 35) tier = 'Emerging';
  else tier = 'Unproven';

  return { reputationScore, tier };
}

/**
 * Compute reputation for all ERC-8183 provider agents.
 * Returns a Map keyed by normalized lowercase provider_agent_id.
 *
 * If agentKeys is provided, only compute for those agents (optimization).
 * Otherwise computes for all providers with ERC-8183 escrow jobs.
 */
export async function getErc8183AgentReputationMap(
  agentKeys?: string[],
): Promise<Map<string, Erc8183AgentReputation>> {
  const result = new Map<string, Erc8183AgentReputation>();

  let db: ReturnType<typeof getSupabaseAdmin>;
  try {
    db = getSupabaseAdmin();
  } catch (error) {
    console.warn(
      '[erc8183-reputation] Supabase unavailable; skipping enrichment',
      error instanceof Error ? error.message : String(error),
    );
    return result;
  }

  // Fetch all ERC-8183 escrow jobs — single query, compute in-memory.
  // Supabase .select() returns max 1000 by default; bump to 5000.
  const { data, error } = await db
    .from('agent_jobs')
    .select(
      'provider_agent_id, status, erc8183_status, price_atomic, complete_tx_hash, submit_tx_hash, reject_tx_hash, settled_at, submitted_at, updated_at, created_at',
    )
    .eq('settlement_mode', 'erc8183_escrow')
    .limit(5000);

  if (error) {
    console.error('[erc8183-reputation] query failed:', error.message);
    return result;
  }

  const rows = (data ?? []) as JobRow[];

  // Normalize agentKeys for fast lookup (if provided)
  const keySet = agentKeys
    ? new Set(agentKeys.map((k) => String(k).toLowerCase()))
    : null;

  // Group by provider_agent_id
  const grouped = new Map<string, JobRow[]>();
  for (const row of rows) {
    const pid = row.provider_agent_id ? String(row.provider_agent_id).toLowerCase() : '';
    if (!pid) continue;
    if (keySet && !keySet.has(pid)) continue;
    const arr = grouped.get(pid);
    if (arr) arr.push(row);
    else grouped.set(pid, [row]);
  }

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  for (const [pid, jobs] of grouped) {
    let completedJobs = 0;
    let submittedJobs = 0;
    let activeJobs = 0;
    let rejectedJobs = 0;
    let failedJobs = 0;
    let expiredJobs = 0;
    let totalVolumeAtomic = BigInt(0);
    let completedLast7d = 0;
    let latestUpdate = '';

    for (const job of jobs) {
      if (isCompleted(job)) {
        completedJobs++;
        totalVolumeAtomic += BigInt(job.price_atomic ?? '0');
        // Recency: check settled_at or updated_at
        const ts = job.settled_at || job.updated_at || job.created_at;
        if (ts && new Date(ts).getTime() >= sevenDaysAgo) completedLast7d++;
      } else if (isRejected(job)) {
        rejectedJobs++;
      } else if (isFailed(job)) {
        failedJobs++;
      } else if (isExpired(job)) {
        expiredJobs++;
      } else if (isSubmitted(job)) {
        submittedJobs++;
      } else if (isActive(job)) {
        activeJobs++;
      }

      // Track latest update
      const ts = job.updated_at || job.created_at;
      if (ts && ts > latestUpdate) latestUpdate = ts;
    }

    const totalJobs = jobs.length;
    const totalVolumeUsdc = Number(totalVolumeAtomic) / 1_000_000;

    const { reputationScore, tier } = computeScore({
      totalJobs,
      completedJobs,
      submittedJobs,
      activeJobs,
      rejectedJobs,
      failedJobs,
      expiredJobs,
      totalVolumeUsdc,
      completedLast7d,
    });

    result.set(pid, {
      source: 'erc8183_agent_jobs',
      score: reputationScore,
      tier,
      totalJobs,
      completedJobs,
      submittedJobs,
      activeJobs,
      rejectedJobs,
      failedJobs,
      expiredJobs,
      totalVolumeAtomic: totalVolumeAtomic.toString(),
      totalVolumeUsdc,
      completedLast7d,
      updatedAt: latestUpdate || new Date().toISOString(),
    });
  }

  return result;
}

/**
 * Enrich an array of agent objects with ERC-8183 reputation data.
 * Matches by agentId, tokenId (normalized lowercase).
 * Returns the enriched array (mutates in-place for performance).
 */
export async function enrichAgentsWithReputation(
  agents: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (agents.length === 0) return agents;

  try {
    // Collect all possible keys for matching
    const allKeys: string[] = [];
    for (const agent of agents) {
      const agentId = agent.agentId ? String(agent.agentId) : '';
      const tokenId = agent.tokenId ? String(agent.tokenId) : '';
      if (agentId) allKeys.push(agentId);
      if (tokenId && tokenId !== agentId) allKeys.push(tokenId);
    }

    const repMap = await getErc8183AgentReputationMap(allKeys);

    for (const agent of agents) {
      const agentId = agent.agentId ? String(agent.agentId).toLowerCase() : '';
      const tokenId = agent.tokenId ? String(agent.tokenId).toLowerCase() : '';
      const rep = repMap.get(agentId) || repMap.get(tokenId);

      if (rep) {
        agent.reputationScore = String(rep.score);
        agent.score = String(rep.score);
        agent.reputation = rep;
      }
    }
  } catch (err) {
    // Best-effort: if Supabase is unavailable or query fails, skip enrichment.
    // This keeps registered-only mode and other paths working without Supabase.
    console.warn('[erc8183-reputation] enrichment skipped:', err instanceof Error ? err.message : 'unknown');
  }

  return agents;
}
