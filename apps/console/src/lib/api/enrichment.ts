/**
 * API Enrichment — Add job counts, reputation, and lifecycle status to existing endpoints.
 *
 * Used by:
 *   /api/a2a/agents — enrich with job count, reputation, runtime status
 *   /api/dashboard/erc8183-agents — fix hard-coded Open status
 *   /api/a2a/reputation/:agentId — unified reputation envelope
 *   /api/erc8183-jobs/by-agent/:agentId — role-aware visibility
 *
 * Does NOT modify UI components or styling.
 * Does NOT create new /api/dashboard/v1/* routes.
 */

import { getSupabaseAdmin } from "@/lib/x402/supabaseClient";

// ── Types ──────────────────────────────────────────────────────────────────

export type AgentEnrichment = {
  agentId: string;
  jobCount: number;
  completedCount: number;
  rejectedCount: number;
  latestJobStatus: string | null;
  runtimeStatus: string | null;
  lastActivity: string | null;
  reputationScore: string;
  feedbackCount: number;
};

export type UnifiedReputation = {
  score: string;
  workScore: string;
  erc8004Score: string;
  feedbackCount: number;
  latestFeedback: unknown | null;
  validation: unknown;
  source: string[];
};

// ── Enrichment Functions ───────────────────────────────────────────────────

/**
 * Get enrichment data for a single agent.
 * Used by /api/a2a/agents to add job counts and reputation.
 */
export async function getAgentEnrichment(agentId: string): Promise<AgentEnrichment> {
  const db = getSupabaseAdmin();

  // Job counts
  const { data: jobs } = await db
    .from("agent_jobs")
    .select("status, created_at")
    .or(`provider_agent_id.eq.${agentId},buyer_agent_id.eq.${agentId},evaluator_agent_id.eq.${agentId}`)
    .order("created_at", { ascending: false });

  const jobCount = jobs?.length ?? 0;
  const completedCount = jobs?.filter((j) => j.status === "completed").length ?? 0;
  const rejectedCount = jobs?.filter((j) => j.status === "rejected").length ?? 0;
  const latestJobStatus = jobs?.[0]?.status ?? null;
  const lastActivity = jobs?.[0]?.created_at ?? null;

  // Runtime status from agent_presence
  const { data: presence } = await db
    .from("agent_presence")
    .select("status, last_seen_at")
    .eq("agent_id", agentId)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const runtimeStatus = presence?.status ?? null;

  // Reputation from publication queue
  const { data: feedback } = await db
    .from("agent_reputation_publication")
    .select("score")
    .eq("target_agent_id", agentId)
    .eq("status", "published");

  const feedbackCount = feedback?.length ?? 0;
  const avgScore = feedbackCount > 0
    ? Math.round(feedback!.reduce((sum, f) => sum + f.score, 0) / feedbackCount)
    : 0;

  // Work score from job completion rate
  const workScore = jobCount > 0
    ? Math.round(((completedCount - rejectedCount) / jobCount) * 100)
    : 0;

  return {
    agentId,
    jobCount,
    completedCount,
    rejectedCount,
    latestJobStatus,
    runtimeStatus,
    lastActivity,
    reputationScore: String(Math.round(workScore * 0.6 + (avgScore + 100) * 0.2)),
    feedbackCount,
  };
}

/**
 * Get enrichment for multiple agents in batch.
 * Used by /api/a2a/agents list endpoint.
 */
export async function getAgentEnrichments(
  agentIds: string[],
): Promise<Map<string, AgentEnrichment>> {
  const map = new Map<string, AgentEnrichment>();

  // Batch query for job counts
  const db = getSupabaseAdmin();
  const { data: allJobs } = await db
    .from("agent_jobs")
    .select("provider_agent_id, buyer_agent_id, evaluator_agent_id, status, created_at");

  // Group jobs by agent
  const jobsByAgent = new Map<string, { status: string; created_at: string }[]>();
  for (const job of allJobs ?? []) {
    for (const id of [job.provider_agent_id, job.buyer_agent_id, job.evaluator_agent_id]) {
      if (id && agentIds.includes(id)) {
        if (!jobsByAgent.has(id)) jobsByAgent.set(id, []);
        jobsByAgent.get(id)!.push({ status: job.status, created_at: job.created_at });
      }
    }
  }

  // Build enrichment for each agent
  for (const agentId of agentIds) {
    const jobs = jobsByAgent.get(agentId) ?? [];
    const jobCount = jobs.length;
    const completedCount = jobs.filter((j) => j.status === "completed").length;
    const rejectedCount = jobs.filter((j) => j.status === "rejected").length;
    const latestJobStatus = jobs[0]?.status ?? null;
    const lastActivity = jobs[0]?.created_at ?? null;

    const workScore = jobCount > 0
      ? Math.round(((completedCount - rejectedCount) / jobCount) * 100)
      : 0;

    map.set(agentId, {
      agentId,
      jobCount,
      completedCount,
      rejectedCount,
      latestJobStatus,
      runtimeStatus: null, // Filled separately if needed
      lastActivity,
      reputationScore: String(workScore),
      feedbackCount: 0, // Filled separately if needed
    });
  }

  return map;
}

/**
 * Derive actual lifecycle status from job/runtime state.
 * Fixes the hard-coded "Open" in the dashboard endpoint.
 */
export function deriveLifecycleStatus(job: {
  status: string;
  setBudgetTxHash?: string | null;
  fundTxHash?: string | null;
  submitTxHash?: string | null;
  completeTxHash?: string | null;
  rejectTxHash?: string | null;
}): string {
  if (job.completeTxHash) return "Completed";
  if (job.rejectTxHash) return "Rejected";
  if (job.submitTxHash) return "Submitted";
  if (job.fundTxHash) return "Funded";
  if (job.setBudgetTxHash) return "BudgetSet";
  return "Open";
}

/**
 * Get unified reputation for an agent.
 * Stable envelope for /api/a2a/reputation/:agentId.
 */
export async function getUnifiedReputation(agentId: string): Promise<UnifiedReputation> {
  const db = getSupabaseAdmin();

  // Job stats
  const { data: jobs } = await db
    .from("agent_jobs")
    .select("status")
    .eq("provider_agent_id", agentId);

  const completedCount = jobs?.filter((j) => j.status === "completed").length ?? 0;
  const rejectedCount = jobs?.filter((j) => j.status === "rejected").length ?? 0;
  const totalJobs = jobs?.length ?? 0;

  const workScore = totalJobs > 0
    ? Math.max(0, Math.min(100, Math.round(((completedCount - rejectedCount) / totalJobs) * 100)))
    : 0;

  // Published feedback
  const { data: feedback } = await db
    .from("agent_reputation_publication")
    .select("*")
    .eq("target_agent_id", agentId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(10);

  const feedbackCount = feedback?.length ?? 0;
  const erc8004Score = feedbackCount > 0
    ? Math.round(feedback!.reduce((sum, f) => sum + f.score, 0) / feedbackCount)
    : 0;

  return {
    score: String(Math.round(workScore * 0.6 + (erc8004Score + 100) * 0.2)),
    workScore: String(workScore),
    erc8004Score: String(erc8004Score),
    feedbackCount,
    latestFeedback: feedback?.[0] ?? null,
    validation: {},
    source: ["erc8183_jobs", "erc8004_reputation"],
  };
}
