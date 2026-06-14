/**
 * Reputation Publisher — Async ERC-8004 feedback publication.
 *
 * Publishes reputation feedback to the ERC-8004 ReputationRegistry after
 * ERC-8183 job settlement. Runs asynchronously — reputation failure does NOT
 * undo settlement.
 *
 * Design:
 *   - Completed job → positive feedback (successful_work)
 *   - Rejected job → negative feedback (failed_acceptance_criteria)
 *   - Manual review → no automatic feedback
 *   - Idempotent: one feedback per (job, source, target, type)
 *   - Retries with exponential backoff
 *   - Uses existing reputation.give_feedback MCP tool
 */

import { keccak256, toBytes } from "viem";
import {
  queueReputationPublication,
  getPendingPublications,
  markPublicationPublished,
  markPublicationFailed,
  type ReputationPublicationRow,
} from "@/lib/erc8183-jobs/deliverable-store";
import { getSupabaseAdmin } from "@/lib/x402/supabaseClient";

// ── Types ──────────────────────────────────────────────────────────────────

export type ReputationFeedbackType =
  | "successful_work"
  | "failed_acceptance_criteria"
  | "manual_review";

export type QueueReputationParams = {
  jobId: string;
  sourceAgentId: string; // The agent giving feedback (evaluator or client)
  targetAgentId: string; // The agent receiving feedback (provider)
  targetAddress: string; // Provider's wallet address
  feedbackType: ReputationFeedbackType;
  score: number; // -100 to 100
  tag?: string;
  reason?: string;
  evidenceHash?: string;
};

export type ReputationPublisherConfig = {
  /** Poll interval for processing queue (default: 30000) */
  pollIntervalMs: number;
  /** Maximum retry attempts (default: 5) */
  maxRetries: number;
  /** Base backoff delay in ms (default: 10000) */
  baseBackoffMs: number;
  /** Maximum backoff delay in ms (default: 300000 = 5 min) */
  maxBackoffMs: number;
};

// ── Queue Reputation ───────────────────────────────────────────────────────

/**
 * Queue reputation feedback for async publication.
 *
 * Called after ERC-8183 settlement:
 *   - Completed → positive feedback for provider
 *   - Rejected → negative feedback for provider
 *   - Manual review → no automatic feedback
 *
 * The queue entry is persisted immediately. Publication happens asynchronously
 * so reputation failure does NOT undo settlement.
 */
export async function queueReputation(params: QueueReputationParams): Promise<{
  ok: boolean;
  queued: boolean;
  error?: string;
}> {
  // Compute evidence hash
  const evidenceHash = params.evidenceHash ??
    keccak256(toBytes(JSON.stringify({
      jobId: params.jobId,
      feedbackType: params.feedbackType,
      score: params.score,
      reason: params.reason,
    })));

  const result = await queueReputationPublication({
    jobId: params.jobId,
    sourceAgentId: params.sourceAgentId,
    targetAgentId: params.targetAgentId,
    targetAddress: params.targetAddress,
    feedbackType: params.feedbackType,
    score: params.score,
    tag: params.tag,
    reason: params.reason,
    evidenceHash,
  });

  if (!result.ok) {
    return { ok: false, queued: false, error: result.error };
  }

  return { ok: true, queued: true };
}

/**
 * Queue reputation for a completed job.
 * Evaluator (or client for self-evaluation) gives positive feedback to provider.
 */
export async function queueCompletedJobReputation(params: {
  jobId: string;
  evaluatorAgentId: string;
  providerAgentId: string;
  providerAddress: string;
  score: number;
  deliverableHash: string;
  settlementTxHash: string;
}): Promise<{ ok: boolean; queued: boolean; error?: string }> {
  return queueReputation({
    jobId: params.jobId,
    sourceAgentId: params.evaluatorAgentId,
    targetAgentId: params.providerAgentId,
    targetAddress: params.providerAddress,
    feedbackType: "successful_work",
    score: params.score,
    tag: "erc8183_job_delivery",
    reason: `Job ${params.jobId} completed successfully`,
    evidenceHash: params.deliverableHash,
  });
}

/**
 * Queue reputation for a rejected job.
 * Evaluator gives negative feedback to provider.
 */
export async function queueRejectedJobReputation(params: {
  jobId: string;
  evaluatorAgentId: string;
  providerAgentId: string;
  providerAddress: string;
  score: number;
  deliverableHash: string;
  settlementTxHash: string;
  failedCriteria: string[];
}): Promise<{ ok: boolean; queued: boolean; error?: string }> {
  return queueReputation({
    jobId: params.jobId,
    sourceAgentId: params.evaluatorAgentId,
    targetAgentId: params.providerAgentId,
    targetAddress: params.providerAddress,
    feedbackType: "failed_acceptance_criteria",
    score: params.score,
    tag: "erc8183_job_rejected",
    reason: `Job ${params.jobId} rejected. Failed criteria: ${params.failedCriteria.join(", ")}`,
    evidenceHash: params.deliverableHash,
  });
}

// ── Publisher Process ──────────────────────────────────────────────────────

/**
 * Process pending reputation publications.
 *
 * Called periodically by the publisher loop. Processes one batch of pending
 * publications, publishing each to the ERC-8004 ReputationRegistry.
 */
export async function processPendingPublications(
  publishFeedback: (params: {
    targetAddress: string;
    score: number;
    tag: string;
    reason: string;
  }) => Promise<string>, // Returns txHash
  config: ReputationPublisherConfig,
): Promise<{
  processed: number;
  published: number;
  failed: number;
  skipped: number;
}> {
  const pending = await getPendingPublications(10);
  let published = 0;
  let failed = 0;
  let skipped = 0;

  for (const pub of pending) {
    try {
      // Check retry limit
      if (pub.attempts >= config.maxRetries) {
        await markPublicationFailed(pub.id, `Max retries (${config.maxRetries}) exceeded`);
        skipped++;
        continue;
      }

      // Publish to ERC-8004
      const txHash = await publishFeedback({
        targetAddress: pub.target_address,
        score: pub.score,
        tag: pub.tag ?? pub.feedback_type,
        reason: pub.reason ?? `Job ${pub.job_id} ${pub.feedback_type}`,
      });

      // Mark published
      await markPublicationPublished(pub.id, txHash);
      published++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Compute next retry with exponential backoff
      const backoff = Math.min(
        config.baseBackoffMs * Math.pow(2, pub.attempts),
        config.maxBackoffMs,
      );
      const nextAttempt = new Date(Date.now() + backoff);

      await markPublicationFailed(pub.id, msg, nextAttempt);
      failed++;
    }
  }

  return {
    processed: pending.length,
    published,
    failed,
    skipped,
  };
}

// ── Unified Reputation Backend ─────────────────────────────────────────────

/**
 * Get unified reputation for an agent.
 *
 * Combines:
 *   - ERC-8183 work score from agent_jobs
 *   - ERC-8004 feedback from agent_reputation_publication
 *   - Validation/proof evidence
 *
 * Returns a stable envelope for the /api/a2a/reputation/:agentId endpoint.
 */
export async function getUnifiedReputation(agentId: string): Promise<{
  score: string;
  workScore: string;
  erc8004Score: string;
  feedbackCount: number;
  latestFeedback: unknown | null;
  validation: unknown;
  source: string[];
}> {
  const db = getSupabaseAdmin();

  // Get completed/rejected job counts
  const { data: jobs } = await db
    .from("agent_jobs")
    .select("status")
    .eq("provider_agent_id", agentId);

  const completedCount = jobs?.filter((j) => j.status === "completed").length ?? 0;
  const rejectedCount = jobs?.filter((j) => j.status === "rejected").length ?? 0;
  const totalJobs = jobs?.length ?? 0;

  // Compute work score (simple: completed - rejected, normalized to 0-100)
  const workScore = totalJobs > 0
    ? Math.max(0, Math.min(100, Math.round(((completedCount - rejectedCount) / totalJobs) * 100)))
    : 0;

  // Get published reputation feedback
  const { data: feedback } = await db
    .from("agent_reputation_publication")
    .select("*")
    .eq("target_agent_id", agentId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(10);

  const feedbackCount = feedback?.length ?? 0;
  const erc8004Score = feedbackCount > 0
    ? Math.round(feedback.reduce((sum, f) => sum + f.score, 0) / feedbackCount)
    : 0;

  // Combined score (weighted average)
  const combinedScore = totalJobs > 0
    ? Math.round(workScore * 0.6 + (erc8004Score + 100) * 0.2) // Normalize erc8004 to 0-200, then weight
    : erc8004Score;

  return {
    score: String(combinedScore),
    workScore: String(workScore),
    erc8004Score: String(erc8004Score),
    feedbackCount,
    latestFeedback: feedback?.[0] ?? null,
    validation: {}, // TODO: integrate validation registry
    source: ["erc8183_jobs", "erc8004_reputation"],
  };
}
