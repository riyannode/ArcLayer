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
import { keccak256, toBytes, decodeEventLog, type Hex } from "viem";
import {
  EvaluationVerdictV1Schema,
} from "@arclayer/runner-core";
import {
  upsertDeliverable,
  getDeliverableByJobId,
  lockDeliverable,
  insertEvaluation,
  attachSettlementTx,
  queueReputationPublication,
  type DeliverableRow,
} from "@/lib/erc8183-jobs/deliverable-store";
import { readOnchainJob, getArcPublicClient } from "@/lib/erc8183-jobs/receipt";
import { CONTRACTS, ERC8183_AGENTIC_COMMERCE_ABI, ARC_DEPLOYMENT_BLOCK } from "@arclayer/sdk";
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

  // Strict: session MUST have at least one bound wallet address
  if (boundAddresses.size === 0) {
    throw new McpError(
      MCP_ERRORS.FORBIDDEN,
      "MCP session has no bound wallet address",
    );
  }

  if (!boundAddresses.has(requestedAddress.toLowerCase())) {
    throw new McpError(
      MCP_ERRORS.FORBIDDEN,
      "Requested wallet is not bound to this MCP session",
    );
  }
}

/**
 * Read the on-chain submitted deliverable hash from JobSubmitted event.
 * Uses the SDK ABI to find the exact event signature.
 */
async function readSubmittedDeliverableHash(jobId: bigint): Promise<Hex | null> {
  const client = getArcPublicClient();

  // Find the JobSubmitted event from the SDK ABI
  const jobSubmittedEvent = ERC8183_AGENTIC_COMMERCE_ABI.find(
    (item): item is Extract<typeof item, { type: "event" }> =>
      item.type === "event" && item.name === "JobSubmitted",
  );

  if (!jobSubmittedEvent) {
    console.warn("[deliverable-tools] JobSubmitted event not found in SDK ABI");
    return null;
  }

  const logs = await client.getLogs({
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    event: jobSubmittedEvent,
    args: { jobId },
    fromBlock: ARC_DEPLOYMENT_BLOCK,
    toBlock: "latest",
  });

  const latest = logs.at(-1);
  // Field is "deliverable" (not "deliverableHash") per SDK ABI
  return (latest?.args as Record<string, unknown>)?.deliverable as Hex ?? null;
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

    // Read on-chain submitted deliverable hash from JobSubmitted event
    const onchainDeliverableHash = await readSubmittedDeliverableHash(BigInt(jobId));

    if (!onchainDeliverableHash) {
      throw new McpError(
        MCP_ERRORS.NOT_FOUND,
        "On-chain submitted deliverable hash not found",
      );
    }

    if (
      onchainDeliverableHash.toLowerCase() !==
      deliverable.deliverable_hash.toLowerCase()
    ) {
      throw new McpError(
        MCP_ERRORS.INTERNAL_ERROR,
        "Stored deliverable hash does not match on-chain submitted hash",
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
      onchainDeliverableHash,
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

// ── evaluator.publish_evaluation ──────────────────────────────────────────

/**
 * evaluator.publish_evaluation
 *
 * Persist evaluator verdict before ERC-8183 settlement.
 * Server verifies:
 *   1. MCP Bearer token authentication
 *   2. Session owns agentId and evaluator wallet
 *   3. On-chain evaluator matches evaluatorAddress
 *   4. Job status is Submitted/Completed/Rejected
 *   5. Verdict.deliverableHash matches supplied deliverableHash
 *   6. Persists via insertEvaluation()
 *
 * Flow: publish_evaluation → complete/reject → attach settlement tx → queue reputation
 */
export async function handleEvaluatorPublishEvaluation(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);

  const agentId = typeof args.agentId === "string" ? args.agentId.trim() : "";
  const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
  const evaluatorAddress =
    typeof args.evaluatorAddress === "string"
      ? args.evaluatorAddress.trim().toLowerCase()
      : "";
  const deliverableHash =
    typeof args.deliverableHash === "string" ? args.deliverableHash.trim() : "";
  const evaluationReceiptHash =
    typeof args.evaluationReceiptHash === "string"
      ? args.evaluationReceiptHash.trim()
      : undefined;

  const verdict = args.verdict as Record<string, unknown> | undefined;

  // Validation
  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "agentId required");
  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "jobId required");
  if (!evaluatorAddress) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "evaluatorAddress required");
  if (!/^0x[a-fA-F0-9]{64}$/.test(deliverableHash)) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "deliverableHash must be bytes32");
  }
  if (!verdict) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "verdict required");

  // Strict schema validation via EvaluationVerdictV1Schema
  const parsedVerdict = EvaluationVerdictV1Schema.safeParse(verdict);

  if (!parsedVerdict.success) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      `Invalid EvaluationVerdictV1: ${parsedVerdict.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const validatedVerdict = parsedVerdict.data;

  // Verify session owns this agent and address
  assertSessionBinding(session as any, agentId, evaluatorAddress);

  // Verify verdict hash matches (now mandatory, not optional)
  if (validatedVerdict.evaluatedDeliverableHash.toLowerCase() !== deliverableHash.toLowerCase()) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "Verdict deliverable hash mismatch");
  }

  try {
    // Read on-chain job to verify evaluator and status
    const onchainJob = await readOnchainJob(BigInt(jobId));
    if (!onchainJob) {
      throw new McpError(MCP_ERRORS.NOT_FOUND, "Job not found on-chain");
    }

    // Verify on-chain evaluator matches
    if (onchainJob.evaluator.toLowerCase() !== evaluatorAddress) {
      throw new McpError(
        MCP_ERRORS.FORBIDDEN,
        "On-chain evaluator does not match requested address",
      );
    }

    // Verify job status is Submitted (2), Completed (3), or Rejected (4)
    if (![2, 3, 4].includes(onchainJob.status)) {
      throw new McpError(
        MCP_ERRORS.VALIDATION_ERROR,
        "Job is not Submitted/Completed/Rejected",
      );
    }

    // Persist evaluation
    const result = await insertEvaluation({
      jobId,
      evaluatorAgentId: agentId,
      evaluatorAddress,
      deliverableHash,
      decision: validatedVerdict.decision as "complete" | "reject" | "manual_review",
      score: Number(validatedVerdict.score),
      confidence: Number(validatedVerdict.confidence),
      reason: String(validatedVerdict.reason),
      evidence: Array.isArray(validatedVerdict.evidence) ? validatedVerdict.evidence : [],
      evaluationReceiptHash,
    });

    if (!result.ok) {
      throw new McpError(MCP_ERRORS.INTERNAL_ERROR, result.error ?? "Failed to persist evaluation");
    }

    return jsonSafe({
      ok: true,
      jobId,
      deliverableHash,
      evaluationId: result.row?.id,
    });
  } catch (err) {
    if (err instanceof McpError) throw err;
    rethrowAsMcpError(err, "Failed to publish evaluation");
  }
}

// ── evaluator.attach_settlement_tx ──────────────────────────────────────────

/**
 * evaluator.attach_settlement_tx
 *
 * Attach settlement tx hash to evaluation after complete/reject.
 * Verifies terminal onchain state before attaching.
 */
export async function handleEvaluatorAttachSettlementTx(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);

  const agentId = typeof args.agentId === "string" ? args.agentId.trim() : "";
  const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
  const evaluatorAddress =
    typeof args.evaluatorAddress === "string"
      ? args.evaluatorAddress.trim().toLowerCase()
      : "";
  const settlementTxHash =
    typeof args.settlementTxHash === "string" ? args.settlementTxHash.trim() : "";

  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "agentId required");
  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "jobId required");
  if (!evaluatorAddress) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "evaluatorAddress required");
  if (!settlementTxHash) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "settlementTxHash required");

  // Validate txHash format (bytes32)
  if (!/^0x[a-fA-F0-9]{64}$/.test(settlementTxHash)) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "settlementTxHash must be bytes32 (0x + 64 hex chars)");
  }

  assertSessionBinding(session as any, agentId, evaluatorAddress);

  try {
    // Verify on-chain terminal state
    const onchainJob = await readOnchainJob(BigInt(jobId));
    if (!onchainJob) {
      throw new McpError(MCP_ERRORS.NOT_FOUND, "Job not found on-chain");
    }

    // Must be Completed (3) or Rejected (4)
    if (![3, 4].includes(onchainJob.status)) {
      throw new McpError(
        MCP_ERRORS.VALIDATION_ERROR,
        `Job is not in terminal state (status=${onchainJob.status})`,
      );
    }

    // Verify transaction receipt
    const client = getArcPublicClient();
    const receipt = await client.getTransactionReceipt({
      hash: settlementTxHash as `0x${string}`,
    });

    if (!receipt) {
      throw new McpError(MCP_ERRORS.NOT_FOUND, "Transaction receipt not found");
    }

    // Verify transaction succeeded
    if (receipt.status !== "success") {
      throw new McpError(
        MCP_ERRORS.VALIDATION_ERROR,
        `Transaction failed (status=${receipt.status})`,
      );
    }

    // Verify transaction targets ERC-8183 contract
    if (receipt.to?.toLowerCase() !== CONTRACTS.ERC8183_AGENTIC_COMMERCE.toLowerCase()) {
      throw new McpError(
        MCP_ERRORS.VALIDATION_ERROR,
        "Transaction does not target ERC-8183 AgenticCommerce contract",
      );
    }

    // Verify transaction contains JobCompleted or JobRejected event for this job
    const jobCompletedEvent = ERC8183_AGENTIC_COMMERCE_ABI.find(
      (item): item is Extract<typeof item, { type: "event" }> =>
        item.type === "event" && item.name === "JobCompleted",
    );
    const jobRejectedEvent = ERC8183_AGENTIC_COMMERCE_ABI.find(
      (item): item is Extract<typeof item, { type: "event" }> =>
        item.type === "event" && item.name === "JobRejected",
    );

    let foundMatchingEvent = false;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== CONTRACTS.ERC8183_AGENTIC_COMMERCE.toLowerCase()) continue;

      // Try JobCompleted
      if (jobCompletedEvent) {
        try {
          const decoded = decodeEventLog({
            abi: [jobCompletedEvent],
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "JobCompleted") {
            const eventJobId = (decoded.args as Record<string, unknown>).jobId;
            if (String(eventJobId) === jobId) {
              foundMatchingEvent = true;
              break;
            }
          }
        } catch { /* not this event */ }
      }

      // Try JobRejected
      if (jobRejectedEvent) {
        try {
          const decoded = decodeEventLog({
            abi: [jobRejectedEvent],
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "JobRejected") {
            const eventJobId = (decoded.args as Record<string, unknown>).jobId;
            if (String(eventJobId) === jobId) {
              foundMatchingEvent = true;
              break;
            }
          }
        } catch { /* not this event */ }
      }
    }

    if (!foundMatchingEvent) {
      throw new McpError(
        MCP_ERRORS.VALIDATION_ERROR,
        "Transaction does not contain JobCompleted/JobRejected event for this job",
      );
    }

    // Attach settlement tx
    const result = await attachSettlementTx(jobId, settlementTxHash);

    if (!result.ok) {
      throw new McpError(MCP_ERRORS.INTERNAL_ERROR, result.error ?? "Failed to attach settlement tx");
    }

    return jsonSafe({
      ok: true,
      jobId,
      settlementTxHash,
      terminalStatus: onchainJob.erc8183Status,
    });
  } catch (err) {
    if (err instanceof McpError) throw err;
    rethrowAsMcpError(err, "Failed to attach settlement tx");
  }
}

// ── evaluator.queue_reputation ──────────────────────────────────────────────

/**
 * evaluator.queue_reputation
 *
 * Queue ERC-8004 reputation publication after verified terminal state.
 * Only queues — actual publication is async.
 * Manual review must NOT queue automatic reputation.
 */
export async function handleEvaluatorQueueReputation(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);

  const agentId = typeof args.agentId === "string" ? args.agentId.trim() : "";
  const jobId = typeof args.jobId === "string" ? args.jobId.trim() : "";
  const evaluatorAddress =
    typeof args.evaluatorAddress === "string"
      ? args.evaluatorAddress.trim().toLowerCase()
      : "";
  const targetAgentId = typeof args.targetAgentId === "string" ? args.targetAgentId.trim() : "";
  const targetAddress = typeof args.targetAddress === "string" ? args.targetAddress.trim().toLowerCase() : "";
  const feedbackType = typeof args.feedbackType === "string" ? args.feedbackType.trim() : "";
  const score = typeof args.score === "number" ? args.score : 0;
  const tag = typeof args.tag === "string" ? args.tag.trim() : undefined;
  const reason = typeof args.reason === "string" ? args.reason.trim() : undefined;
  const evidenceHash = typeof args.evidenceHash === "string" ? args.evidenceHash.trim() : undefined;

  if (!agentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "agentId required");
  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "jobId required");
  if (!evaluatorAddress) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "evaluatorAddress required");
  if (!targetAgentId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "targetAgentId required");
  if (!targetAddress) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "targetAddress required");
  if (!feedbackType) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, "feedbackType required");

  // Only allow valid feedback types
  const validFeedbackTypes = ["successful_work", "failed_acceptance_criteria"];
  if (!validFeedbackTypes.includes(feedbackType)) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      `Invalid feedbackType. Allowed: ${validFeedbackTypes.join(", ")}`,
    );
  }

  assertSessionBinding(session as any, agentId, evaluatorAddress);

  try {
    // Verify terminal state
    const onchainJob = await readOnchainJob(BigInt(jobId));
    if (!onchainJob) {
      throw new McpError(MCP_ERRORS.NOT_FOUND, "Job not found on-chain");
    }

    if (![3, 4].includes(onchainJob.status)) {
      throw new McpError(
        MCP_ERRORS.VALIDATION_ERROR,
        "Can only queue reputation for Completed/Rejected jobs",
      );
    }

    // Enforce terminal status → feedback type mapping
    if (onchainJob.status === 3 && feedbackType !== "successful_work") {
      throw new McpError(
        MCP_ERRORS.VALIDATION_ERROR,
        "Completed jobs can only queue successful_work feedback",
      );
    }

    if (onchainJob.status === 4 && feedbackType !== "failed_acceptance_criteria") {
      throw new McpError(
        MCP_ERRORS.VALIDATION_ERROR,
        "Rejected jobs can only queue failed_acceptance_criteria feedback",
      );
    }

    // Verify target is the on-chain provider
    if (onchainJob.provider.toLowerCase() !== targetAddress.toLowerCase()) {
      throw new McpError(
        MCP_ERRORS.FORBIDDEN,
        "Reputation target must be the on-chain provider",
      );
    }

    const result = await queueReputationPublication({
      jobId,
      sourceAgentId: agentId,
      targetAgentId,
      targetAddress,
      feedbackType,
      score,
      tag,
      reason,
      evidenceHash,
    });

    if (!result.ok) {
      throw new McpError(MCP_ERRORS.INTERNAL_ERROR, result.error ?? "Failed to queue reputation");
    }

    return jsonSafe({
      ok: true,
      jobId,
      feedbackType,
      publicationId: result.row?.id,
    });
  } catch (err) {
    if (err instanceof McpError) throw err;
    rethrowAsMcpError(err, "Failed to queue reputation");
  }
}
