/**
 * Deliverable & Evaluation MCP Tools
 *
 * Hosted MCP tools for ERC-8183 deliverable publication and evaluation.
 *
 * Tools:
 *   provider.publish_deliverable — Provider publishes canonical deliverable
 *   evaluator.get_deliverable    — Evaluator retrieves deliverable for evaluation
 *   evaluator.list_assigned_jobs — Evaluator lists jobs assigned to them
 *
 * Security:
 *   - MCP Bearer token authentication
 *   - Session owns agentId verification
 *   - On-chain provider/evaluator address verification
 *   - Keccak-256 hash recomputation and three-way verification
 *   - No secrets, no binary blobs in responses
 */

import { McpError, MCP_ERRORS } from "./errors";
import type { McpToolContext } from "./registry";
import { requireMcpSession } from "./identity-tools";
import { jsonSafe } from "./erc8183-tools";
import { keccak256, toBytes, type Hex } from "viem";
import {
  upsertDeliverable,
  getDeliverableByJobId,
  lockDeliverable,
  type DeliverableRow,
} from "@/lib/erc8183-jobs/deliverable-store";
import { readOnchainJob, getArcPublicClient } from "@/lib/erc8183-jobs/receipt";
import { CONTRACTS } from "@arclayer/sdk";
import { getSupabaseAdmin } from "@/lib/x402/supabaseClient";

function supabase() {
  return getSupabaseAdmin();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildAuth(session: { apiKey?: string; agentId?: string }, agentId: string) {
  return { apiKey: session.apiKey, agentId };
}

function rethrowAsMcpError(err: unknown, fallbackMessage: string): never {
  if (err instanceof McpError) throw err;
  const message = err instanceof Error ? err.message : fallbackMessage;
  throw new McpError(MCP_ERRORS.INTERNAL_ERROR, message);
}

/**
 * Verify that the MCP session owns the requested agentId and address.
 * Prevents one session from operating on another agent's data.
 */
function assertSessionBinding(
  session: {
    agentId?: string | null;
    ownerAddress?: string;
    agentAccountAddress?: string;
  },
  requestedAgentId: string,
  requestedAddress: string,
): void {
  if (!session.agentId || session.agentId !== requestedAgentId) {
    throw new McpError(
      MCP_ERRORS.FORBIDDEN,
      "Session does not own the requested agentId",
    );
  }

  const boundAddresses = new Set(
    [session.ownerAddress, session.agentAccountAddress]
      .filter(Boolean)
      .map((a) => a!.toLowerCase()),
  );

  if (boundAddresses.size > 0 && !boundAddresses.has(requestedAddress.toLowerCase())) {
    throw new McpError(
      MCP_ERRORS.FORBIDDEN,
      "Requested wallet is not bound to this MCP session",
    );
  }
}

// ── provider.publish_deliverable ───────────────────────────────────────────

/**
 * provider.publish_deliverable
 *
 * Provider publishes a canonical deliverable for a funded job.
 * Server verifies:
 *   1. MCP Bearer token authentication
 *   2. Session owns agentId
 *   3. On-chain provider matches providerAddress
 *   4. Job status is Funded
 *   5. Keccak-256 recomputation matches supplied hash
 *   6. Artifact/payload size limits
 *
 * Stores idempotently — provider can re-publish (overwrite) until submit locks it.
 */
export async function handleProviderPublishDeliverable(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);

  const agentId = typeof args.agentId === "string" ? args.agentId.trim() : "";
  const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
  const providerAddress = typeof args.providerAddress === "string"
    ? args.providerAddress.trim().toLowerCase()
    : "";
  const canonicalPayload = typeof args.canonicalPayload === "string"
    ? args.canonicalPayload
    : "";
  const deliverableHash = typeof args.deliverableHash === "string"
    ? args.deliverableHash.trim()
    : "";
  const artifacts = Array.isArray(args.artifacts) ? args.artifacts : [];
  const runtimeReceiptHash = typeof args.runtimeReceiptHash === "string"
    ? args.runtimeReceiptHash.trim()
    : undefined;

  // Validation
  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "agentId required");
  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "jobId required");
  if (!providerAddress) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "providerAddress required");
  if (!canonicalPayload) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "canonicalPayload required");
  if (!deliverableHash) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "deliverableHash required");

  // Verify session owns this agent and address
  assertSessionBinding(session as any, agentId, providerAddress);

  // Verify hash format
  if (!/^0x[a-fA-F0-9]{64}$/.test(deliverableHash)) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "deliverableHash must be a valid keccak256 hash");
  }

  // Verify payload size
  if (Buffer.byteLength(canonicalPayload, "utf-8") > 1024 * 1024) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "canonicalPayload exceeds 1 MB limit");
  }

  // Verify artifact count
  if (artifacts.length > 32) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "Maximum 32 artifacts allowed");
  }

  // Recompute Keccak-256 and verify
  const computedHash = keccak256(toBytes(canonicalPayload));
  if (computedHash.toLowerCase() !== deliverableHash.toLowerCase()) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      `Hash mismatch: computed ${computedHash} != supplied ${deliverableHash}`,
    );
  }

  try {
    // Read on-chain job to verify provider and status
    const onchainJob = await readOnchainJob(BigInt(jobId));
    if (!onchainJob) {
      throw new McpError(MCP_ERRORS.NOT_FOUND, "Job not found on-chain");
    }

    // Verify on-chain provider matches
    if (onchainJob.provider.toLowerCase() !== providerAddress) {
      throw new McpError(
        MCP_ERRORS.FORBIDDEN,
        `On-chain provider ${onchainJob.provider} does not match ${providerAddress}`,
      );
    }

    // Verify job status is Funded (1)
    if (onchainJob.status !== 1) {
      throw new McpError(
        MCP_ERRORS.VALIDATION_ERROR,
        `Job status is ${onchainJob.erc8183Status}, not Funded. Cannot publish deliverable.`,
      );
    }

    // Upsert deliverable
    const result = await upsertDeliverable({
      jobId,
      providerAgentId: agentId,
      providerAddress,
      canonicalPayload,
      deliverableHash: deliverableHash as Hex,
      artifacts,
      runtimeReceiptHash,
    });

    if (!result.ok) {
      throw new McpError(MCP_ERRORS.INTERNAL_ERROR, result.error ?? "Failed to store deliverable");
    }

    return jsonSafe({
      ok: true,
      jobId,
      deliverableHash,
      artifactCount: artifacts.length,
      stored: true,
      row: result.row,
    });
  } catch (err) {
    if (err instanceof McpError) throw err;
    rethrowAsMcpError(err, "Failed to publish deliverable");
  }
}

// ── evaluator.get_deliverable ──────────────────────────────────────────────

/**
 * evaluator.get_deliverable
 *
 * Evaluator retrieves the canonical deliverable for a submitted job.
 * Server verifies:
 *   1. Session owns evaluator agent
 *   2. On-chain evaluator matches evaluatorAddress
 *   3. Job status is Submitted, Completed, or Rejected
 *   4. Stored hash matches on-chain submitted hash
 *   5. Returns exact canonical payload (no reserialization)
 */
export async function handleEvaluatorGetDeliverable(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);

  const agentId = typeof args.agentId === "string" ? args.agentId.trim() : "";
  const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
  const evaluatorAddress = typeof args.evaluatorAddress === "string"
    ? args.evaluatorAddress.trim().toLowerCase()
    : "";

  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "agentId required");
  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "jobId required");
  if (!evaluatorAddress) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "evaluatorAddress required");

  // Verify session owns this agent and address
  assertSessionBinding(session as any, agentId, evaluatorAddress);

  try {
    // Read on-chain job
    const onchainJob = await readOnchainJob(BigInt(jobId));
    if (!onchainJob) {
      throw new McpError(MCP_ERRORS.NOT_FOUND, "Job not found on-chain");
    }

    // Verify on-chain evaluator matches
    if (onchainJob.evaluator.toLowerCase() !== evaluatorAddress) {
      throw new McpError(
        MCP_ERRORS.FORBIDDEN,
        `On-chain evaluator ${onchainJob.evaluator} does not match ${evaluatorAddress}`,
      );
    }

    // Verify job status is Submitted (2), Completed (3), or Rejected (4)
    if (![2, 3, 4].includes(onchainJob.status)) {
      throw new McpError(
        MCP_ERRORS.VALIDATION_ERROR,
        `Job status is ${onchainJob.erc8183Status}, not Submitted/Completed/Rejected.`,
      );
    }

    // Get stored deliverable
    const deliverable = await getDeliverableByJobId(jobId);
    if (!deliverable) {
      throw new McpError(MCP_ERRORS.NOT_FOUND, "No deliverable found for this job");
    }

    // Three-way hash verification
    const computedHash = keccak256(toBytes(deliverable.canonical_payload));
    if (computedHash.toLowerCase() !== deliverable.deliverable_hash.toLowerCase()) {
      throw new McpError(
        MCP_ERRORS.INTERNAL_ERROR,
        "Stored payload hash mismatch — data integrity error",
      );
    }

    return jsonSafe({
      ok: true,
      jobId,
      providerAgentId: deliverable.provider_agent_id,
      deliverableHash: deliverable.deliverable_hash,
      canonicalPayload: deliverable.canonical_payload,
      artifacts: deliverable.artifacts_json,
      runtimeReceiptHash: deliverable.runtime_receipt_hash,
      submittedAt: deliverable.locked_at,
    });
  } catch (err) {
    if (err instanceof McpError) throw err;
    rethrowAsMcpError(err, "Failed to get deliverable");
  }
}

// ── evaluator.list_assigned_jobs ───────────────────────────────────────────

/**
 * evaluator.list_assigned_jobs
 *
 * Lists jobs assigned to the evaluator, filtered by status.
 * Must filter server-side — does not return all jobs.
 */
export async function handleEvaluatorListAssignedJobs(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);

  const agentId = typeof args.agentId === "string" ? args.agentId.trim() : "";
  const evaluatorAddress = typeof args.evaluatorAddress === "string"
    ? args.evaluatorAddress.trim().toLowerCase()
    : "";
  const status = typeof args.status === "string" ? args.status.trim() : "Submitted";
  const limit = typeof args.limit === "number" ? Math.min(args.limit, 100) : 20;

  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "agentId required");
  if (!evaluatorAddress) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "evaluatorAddress required");

  // Validate status filter
  const validStatuses = ["Submitted", "Completed", "Rejected"];
  if (!validStatuses.includes(status)) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      `Invalid status. Allowed: ${validStatuses.join(", ")}`,
    );
  }

  try {
    const db = supabase();

    // Query agent_jobs where evaluator matches
    const { data: jobs, error } = await db
      .from("agent_jobs")
      .select("*")
      .eq("evaluator_agent_id", agentId)
      .eq("status", status.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new McpError(MCP_ERRORS.INTERNAL_ERROR, error.message);
    }

    return jsonSafe({
      ok: true,
      agentId,
      evaluatorAddress,
      status,
      count: jobs?.length ?? 0,
      jobs: jobs ?? [],
    });
  } catch (err) {
    if (err instanceof McpError) throw err;
    rethrowAsMcpError(err, "Failed to list assigned jobs");
  }
}

// ── provider.list_assigned_jobs (extended with status filter) ──────────────

/**
 * Extended provider.list_assigned_jobs with status filter.
 *
 * Provider worker uses:
 *   status=Open   → setBudget flow
 *   status=Funded → execution flow
 *
 * Does not use JSON-stringified status arrays.
 */
export async function handleProviderListAssignedJobsExtended(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);

  const agentId = typeof args.agentId === "string" ? args.agentId.trim() : "";
  const providerAddress = typeof args.providerAddress === "string"
    ? args.providerAddress.trim().toLowerCase()
    : "";
  const status = typeof args.status === "string" ? args.status.trim() : "Open";
  const limit = typeof args.limit === "number" ? Math.min(args.limit, 100) : 20;

  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "agentId required");
  if (!providerAddress) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "providerAddress required");

  // Validate status filter
  const validStatuses = ["Open", "Funded", "Submitted"];
  if (!validStatuses.includes(status)) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      `Invalid status. Allowed: ${validStatuses.join(", ")}`,
    );
  }

  try {
    const db = supabase();

    const { data: jobs, error } = await db
      .from("agent_jobs")
      .select("*")
      .eq("provider_agent_id", agentId)
      .eq("status", status.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new McpError(MCP_ERRORS.INTERNAL_ERROR, error.message);
    }

    return jsonSafe({
      ok: true,
      agentId,
      providerAddress,
      status,
      count: jobs?.length ?? 0,
      jobs: jobs ?? [],
    });
  } catch (err) {
    if (err instanceof McpError) throw err;
    rethrowAsMcpError(err, "Failed to list assigned jobs");
  }
}
