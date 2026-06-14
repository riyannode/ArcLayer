/**
 * Deliverable & Evaluation store — Supabase operations for ERC-8183 deliverables and evaluations.
 *
 * Used by:
 *   - Hosted MCP tools (provider.publish_deliverable, evaluator.get_deliverable)
 *   - Provider worker (after runtime completes)
 *   - Evaluator worker (after evaluation settles)
 *   - Reconciliation (hash consistency checks)
 *
 * Design:
 *   - Idempotent inserts (upsert on job_id)
 *   - Immutable after terminal state (deliverable: after submit, evaluation: after settlement)
 *   - No secrets, no binary blobs
 *   - Maximum payload 1 MB, maximum 32 artifacts
 */

import { getSupabaseAdmin } from "@/lib/x402/supabaseClient";

function supabase() {
  return getSupabaseAdmin();
}
import type { CanonicalDeliverableV1, EvaluationVerdictV1 } from "@arclayer/runner-core";

// ── Types ──────────────────────────────────────────────────────────────────

export type DeliverableRow = {
  id: string;
  job_id: string;
  provider_agent_id: string;
  provider_address: string;
  evaluator_address: string | null;
  schema_version: number;
  canonical_payload: string;
  deliverable_hash: string;
  artifacts_json: unknown[];
  runtime_receipt_hash: string | null;
  submit_tx_hash: string | null;
  created_at: string;
  updated_at: string;
  locked_at: string | null;
};

export type EvaluationRow = {
  id: string;
  job_id: string;
  evaluator_agent_id: string;
  evaluator_address: string;
  deliverable_hash: string;
  decision: "complete" | "reject" | "manual_review";
  score: number;
  confidence: number;
  reason: string;
  evidence_json: unknown[];
  evaluation_receipt_hash: string | null;
  settlement_tx_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type ReputationPublicationRow = {
  id: string;
  job_id: string;
  source_agent_id: string;
  target_agent_id: string;
  target_address: string;
  feedback_type: string;
  score: number;
  tag: string | null;
  reason: string | null;
  evidence_hash: string | null;
  status: "pending" | "published" | "failed" | "skipped";
  attempts: number;
  next_attempt_at: string | null;
  tx_hash: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

// ── Deliverable Operations ─────────────────────────────────────────────────

/**
 * Insert or update a deliverable record.
 *
 * Idempotent: if a deliverable with the same job_id already exists and is NOT
 * locked (submit_tx_hash set), it will be updated. If it IS locked, the insert
 * is rejected (provider cannot overwrite after submit).
 */
export async function upsertDeliverable(params: {
  jobId: string;
  providerAgentId: string;
  providerAddress: string;
  evaluatorAddress?: string;
  canonicalPayload: string;
  deliverableHash: string;
  artifacts: unknown[];
  runtimeReceiptHash?: string;
}): Promise<{ ok: boolean; row?: DeliverableRow; error?: string }> {
  const db = supabase();

  // Check if existing deliverable is locked (already submitted)
  const { data: existing } = await db
    .from("agent_job_deliverables")
    .select("id, submit_tx_hash, locked_at")
    .eq("job_id", params.jobId)
    .maybeSingle();

  if (existing && (existing.submit_tx_hash || existing.locked_at)) {
    return {
      ok: false,
      error: "Deliverable is locked after submission. Cannot overwrite.",
    };
  }

  const row = {
    job_id: params.jobId,
    provider_agent_id: params.providerAgentId,
    provider_address: params.providerAddress,
    evaluator_address: params.evaluatorAddress ?? null,
    schema_version: 1,
    canonical_payload: params.canonicalPayload,
    deliverable_hash: params.deliverableHash,
    artifacts_json: params.artifacts,
    runtime_receipt_hash: params.runtimeReceiptHash ?? null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // Update existing
    const { data, error } = await db
      .from("agent_job_deliverables")
      .update(row)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, row: data as DeliverableRow };
  }

  // Insert new
  const { data, error } = await db
    .from("agent_job_deliverables")
    .insert({ ...row, created_at: new Date().toISOString() })
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data as DeliverableRow };
}

/**
 * Get a deliverable by job_id.
 */
export async function getDeliverableByJobId(
  jobId: string,
): Promise<DeliverableRow | null> {
  const db = supabase();
  const { data } = await db
    .from("agent_job_deliverables")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  return (data as DeliverableRow) ?? null;
}

/**
 * Lock a deliverable after on-chain submit.
 * Sets submit_tx_hash and locked_at — makes the record immutable.
 */
export async function lockDeliverable(
  jobId: string,
  submitTxHash: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = supabase();
  const { data, error } = await db
    .from("agent_job_deliverables")
    .update({
      submit_tx_hash: submitTxHash,
      locked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .is("submit_tx_hash", null)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Deliverable not found or already locked" };
  return { ok: true };
}

// ── Evaluation Operations ──────────────────────────────────────────────────

/**
 * Insert an evaluation record.
 *
 * Idempotent: one final evaluation per job.
 * If an evaluation already exists with a terminal decision, rejects.
 */
export async function insertEvaluation(params: {
  jobId: string;
  evaluatorAgentId: string;
  evaluatorAddress: string;
  deliverableHash: string;
  decision: "complete" | "reject" | "manual_review";
  score: number;
  confidence: number;
  reason: string;
  evidence: unknown[];
  evaluationReceiptHash?: string;
}): Promise<{ ok: boolean; row?: EvaluationRow; error?: string }> {
  const db = supabase();

  // Check if terminal evaluation already exists
  const { data: existing } = await db
    .from("agent_job_evaluations")
    .select("id, decision, settlement_tx_hash")
    .eq("job_id", params.jobId)
    .maybeSingle();

  if (existing && existing.settlement_tx_hash) {
    return {
      ok: false,
      error: "Evaluation already settled. Cannot overwrite.",
    };
  }

  const row = {
    job_id: params.jobId,
    evaluator_agent_id: params.evaluatorAgentId,
    evaluator_address: params.evaluatorAddress,
    deliverable_hash: params.deliverableHash,
    decision: params.decision,
    score: params.score,
    confidence: params.confidence,
    reason: params.reason,
    evidence_json: params.evidence,
    evaluation_receipt_hash: params.evaluationReceiptHash ?? null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    // Update existing (e.g., from manual_review to final)
    const { data, error } = await db
      .from("agent_job_evaluations")
      .update(row)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, row: data as EvaluationRow };
  }

  // Insert new
  const { data, error } = await db
    .from("agent_job_evaluations")
    .insert({ ...row, created_at: new Date().toISOString() })
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data as EvaluationRow };
}

/**
 * Get an evaluation by job_id.
 */
export async function getEvaluationByJobId(
  jobId: string,
): Promise<EvaluationRow | null> {
  const db = supabase();
  const { data } = await db
    .from("agent_job_evaluations")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  return (data as EvaluationRow) ?? null;
}

/**
 * Attach settlement tx hash to an evaluation.
 */
export async function attachSettlementTx(
  jobId: string,
  settlementTxHash: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = supabase();
  const { error } = await db
    .from("agent_job_evaluations")
    .update({
      settlement_tx_hash: settlementTxHash,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .is("settlement_tx_hash", null)
    .update({ settlement_tx_hash: settlementTxHash });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── Reputation Publication Queue ───────────────────────────────────────────

/**
 * Queue a reputation publication for async processing.
 */
export async function queueReputationPublication(params: {
  jobId: string;
  sourceAgentId: string;
  targetAgentId: string;
  targetAddress: string;
  feedbackType: string;
  score: number;
  tag?: string;
  reason?: string;
  evidenceHash?: string;
}): Promise<{ ok: boolean; row?: ReputationPublicationRow; error?: string }> {
  const db = supabase();

  const { data, error } = await db
    .from("agent_reputation_publication")
    .upsert(
      {
        job_id: params.jobId,
        source_agent_id: params.sourceAgentId,
        target_agent_id: params.targetAgentId,
        target_address: params.targetAddress,
        feedback_type: params.feedbackType,
        score: params.score,
        tag: params.tag ?? null,
        reason: params.reason ?? null,
        evidence_hash: params.evidenceHash ?? null,
        status: "pending",
        attempts: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_id,source_agent_id,target_agent_id,feedback_type" },
    )
    .select("*")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data as ReputationPublicationRow };
}

/**
 * Get pending reputation publications ready for processing.
 */
export async function getPendingPublications(
  limit = 10,
): Promise<ReputationPublicationRow[]> {
  const db = supabase();
  const { data } = await db
    .from("agent_reputation_publication")
    .select("*")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  return (data as ReputationPublicationRow[]) ?? [];
}

/**
 * Mark a reputation publication as published.
 */
export async function markPublicationPublished(
  id: string,
  txHash: string,
): Promise<void> {
  const db = supabase();
  await db
    .from("agent_reputation_publication")
    .update({
      status: "published",
      tx_hash: txHash,
      attempts: db.rpc ? undefined : 1, // increment handled by RPC or manual
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/**
 * Mark a publication attempt as failed, schedule retry.
 */
export async function markPublicationFailed(
  id: string,
  error: string,
  nextAttemptAt?: Date,
): Promise<void> {
  const db = supabase();
  await db
    .from("agent_reputation_publication")
    .update({
      status: "failed",
      last_error: error,
      next_attempt_at: nextAttemptAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}
