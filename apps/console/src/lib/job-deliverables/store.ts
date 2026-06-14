/**
 * Job deliverable store — Supabase-backed shared deliverable storage.
 *
 * Provider publishes deliverable here after runtime completes.
 * Evaluator reads from here to verify and evaluate.
 *
 * Security:
 * - Provider must own the agentId
 * - Onchain job must match provider address
 * - Hash recomputed server-side and compared
 * - Payload size bounded
 * - One canonical deliverable per job
 */
import { createHash } from "node:crypto";
import type { JobDeliverable, PublishDeliverableInput, GetDeliverableInput } from "./types";

// ── Hash verification ──────────────────────────────────────────────────

/**
 * Recompute canonical deliverable hash from payload.
 * The hash is SHA-256 of the JSON-stringified payload.
 */
export function computeDeliverableHash(payload: unknown): string {
  const canonical = typeof payload === "string" ? payload : JSON.stringify(payload);
  return "0x" + createHash("sha256").update(canonical).digest("hex");
}

/**
 * Verify deliverable hash matches the stored payload.
 */
export function verifyDeliverableHash(stored: JobDeliverable): boolean {
  const recomputed = computeDeliverableHash(stored.payload_json);
  return recomputed.toLowerCase() === stored.deliverable_hash.toLowerCase();
}

// ── Supabase operations ────────────────────────────────────────────────

/**
 * Publish a deliverable to Supabase.
 * Returns the stored deliverable or throws on validation failure.
 */
export async function publishDeliverable(
  supabase: any,
  input: PublishDeliverableInput
): Promise<JobDeliverable> {
  // Validate deliverable hash format
  if (!/^0x[a-fA-F0-9]{64}$/.test(input.deliverableHash)) {
    throw new Error("Invalid deliverable hash format (must be bytes32)");
  }

  // Validate provider address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.providerAddress)) {
    throw new Error("Invalid provider address format");
  }

  // Recompute hash server-side
  const recomputedHash = computeDeliverableHash(input.payload);
  if (recomputedHash.toLowerCase() !== input.deliverableHash.toLowerCase()) {
    throw new Error(
      `Deliverable hash mismatch: stored=${input.deliverableHash} recomputed=${recomputedHash}`
    );
  }

  // Bound payload size (max 1MB when stringified)
  const payloadStr = JSON.stringify(input.payload);
  if (payloadStr.length > 1_048_576) {
    throw new Error("Payload exceeds 1MB size limit");
  }

  // Bound artifacts count
  if (input.artifacts && input.artifacts.length > 20) {
    throw new Error("Artifacts count exceeds maximum of 20");
  }

  // Upsert (one canonical deliverable per job)
  // Cast to any — table type not in generated Supabase types until migration is applied
  const { data, error } = await (supabase as any)
    .from("agent_job_deliverables")
    .upsert(
      {
        job_id: input.jobId,
        provider_agent_id: input.agentId,
        provider_address: input.providerAddress.toLowerCase(),
        deliverable_hash: input.deliverableHash.toLowerCase(),
        payload_json: input.payload,
        artifacts_json: input.artifacts ?? [],
        runtime_receipt_hash: input.runtimeReceiptHash ?? null,
      },
      { onConflict: "job_id" }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to publish deliverable: ${error.message}`);
  return data as JobDeliverable;
}

/**
 * Get a deliverable by job ID.
 * Returns null if not found.
 */
export async function getDeliverable(
  supabase: any,
  input: GetDeliverableInput
): Promise<(JobDeliverable & { integrityValid: boolean }) | null> {
  const { data, error } = await (supabase as any)
    .from("agent_job_deliverables")
    .select("*")
    .eq("job_id", input.jobId)
    .single();

  if (error || !data) return null;

  const deliverable = data as JobDeliverable;
  return {
    ...deliverable,
    integrityValid: verifyDeliverableHash(deliverable),
  };
}
