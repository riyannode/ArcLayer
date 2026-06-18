/**
 * Evaluator Worker — Autonomous ERC-8183 evaluation processor.
 *
 * Discovers Submitted jobs assigned to this evaluator, verifies deliverables,
 * runs evaluation, and settles (complete/reject/manual_review).
 *
 * Design:
 *   - 1 VPS = 1 role = 1 agentId = 1 wallet
 *   - Maximum concurrent evaluations: 1
 *   - Retry policy: max 3 runtime retries, exponential backoff
 *   - Runtime failure NEVER auto-rejects the provider
 *   - Hash mismatch → manual review
 *   - Low confidence → manual review
 *   - Reuses existing RunnerServices (completeJob, rejectJob)
 *   - Settlement flow: publish_evaluation → complete/reject → attach_settlement_tx → queue_reputation
 *
 * CLI:
 *   arclayer-runner evaluator-worker
 *   arclayer-runner evaluator-worker --once
 */

import { EventEmitter } from "node:events";
import { keccak256, toBytes, type Hex } from "viem";
import type { RunnerConfig } from "@arclayer/runner-core";
import {
  decodeEvaluationVerdict,
  determineSettlementAction,
  verifyEvaluatedHash,
  decodeJobEnvelope,
  decodeDeliverable,
  type EvaluationVerdictV1,
} from "@arclayer/runner-core";
import type { RunnerServices } from "../services";
import type { ArcLayerMcpConnector } from "../mcp-connector";
import { requireObject } from "../mcp-connector";
import type { RuntimeConnector } from "../runtime";

// ── Types ──────────────────────────────────────────────────────────────────

export type EvaluatorWorkerConfig = {
  pollIntervalMs: number;
  maxConcurrentJobs: number;
  maxRuntimeRetries: number;
  baseBackoffMs: number;
};

type WorkerState = "idle" | "running" | "stopping" | "stopped";

type EvalPhase =
  | "discovered"
  | "verifying_hash"
  | "executing_evaluation"
  | "evaluating"
  | "settling"
  | "completed"
  | "rejected"
  | "manual_review"
  | "needs_action"
  | "failed";

type ActiveEvaluation = {
  jobId: string;
  erc8183JobId: string;
  phase: EvalPhase;
  startedAt: Date;
  retryCount: number;
  lastError?: string;
};

// ── Evaluator Worker ───────────────────────────────────────────────────────

export class EvaluatorWorker extends EventEmitter {
  private state: WorkerState = "idle";
  private pollTimer?: ReturnType<typeof setInterval>;
  private activeEval: ActiveEvaluation | null = null;
  private processedIds = new Set<string>();
  private readonly retryCounts = new Map<string, number>();

  constructor(
    private readonly config: RunnerConfig,
    private readonly services: RunnerServices,
    private readonly mcp: ArcLayerMcpConnector,
    private readonly runtime: RuntimeConnector,
    private readonly workerConfig: EvaluatorWorkerConfig,
  ) {
    super();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "stopped") {
      throw new Error(`Cannot start worker in state ${this.state}`);
    }

    await this.verifyIdentity();
    await this.reconcilePending();

    this.state = "running";
    this.emit("worker.started", { agentId: this.config.agentId });

    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        console.error(`[evaluator-worker] Poll error: ${err.message}`);
      });
    }, this.workerConfig.pollIntervalMs);

    await this.poll();
  }

  async stop(): Promise<void> {
    this.state = "stopping";
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.state = "stopped";
    this.emit("worker.stopped", { agentId: this.config.agentId });
  }

  getState(): WorkerState {
    return this.state;
  }

  /**
   * Run one poll cycle then exit. No setInterval.
   * Used by CLI --once flag.
   */
  async runOnce(): Promise<void> {
    if (this.state !== "idle" && this.state !== "stopped") {
      throw new Error(`Cannot run once in state ${this.state}`);
    }

    await this.verifyIdentity();
    await this.reconcilePending();

    this.state = "running";
    try {
      await this.poll();
    } finally {
      this.state = "stopped";
    }
  }

  // ── Startup Verification ───────────────────────────────────────────────

  private async verifyIdentity(): Promise<void> {
    if (this.config.defaultRole !== "evaluator") {
      throw new Error(`Worker requires role=evaluator, got ${this.config.defaultRole}`);
    }
    if (!process.env.ARCLAYER_MCP_TOKEN) {
      throw new Error("ARCLAYER_MCP_TOKEN required");
    }
    if (!this.config.circleWalletAddress) {
      throw new Error("Circle wallet address required");
    }
    if (this.config.chain !== "ARC-TESTNET") {
      throw new Error(`Expected ARC-TESTNET, got ${this.config.chain}`);
    }

    // Verify ERC-8004 registration
    try {
      await this.mcp.callTool("identity.get_agent_account", {});
    } catch (err) {
      throw new Error(`ERC-8004 identity verification failed: ${err}`);
    }

    // Verify wallet adapter status
    try {
      await this.services.circleStatus();
    } catch (err) {
      throw new Error(`Wallet adapter status check failed: ${err}`);
    }
  }

  private async reconcilePending(): Promise<void> {
    // Reconcile pending operations with postcondition verification
    try {
      const pendingOps = this.services.listReconcilableOperations();
      for (const op of pendingOps) {
        try {
          const verified = await this.verifyPostcondition(op);
          await this.services.reconcileOperation(
            op.operationId,
            verified.outcome,
            { txHash: verified.txHash, errorMessage: verified.error },
          );
        } catch (err) {
          console.warn(`[evaluator] Reconciliation failed for ${op.operationId}: ${err}`);
        }
      }
      if (pendingOps.length > 0) {
        console.log(`[evaluator] Reconciled ${pendingOps.length} pending operations`);
      }
    } catch (err) {
      console.warn(`[evaluator] Reconciliation warning: ${err}`);
    }
  }

  private async verifyPostcondition(
    op: { operationId: string; kind: string; idempotencyKey: string },
  ): Promise<{ outcome: "confirmed" | "failed" | "unknown"; txHash?: string; error?: string }> {
    const parts = op.idempotencyKey.split(":");
    const jobId = parts[1];

    if (!jobId) {
      return { outcome: "unknown", error: "Cannot extract jobId from idempotencyKey" };
    }

    try {
      const statusRaw = await this.mcp.callTool("jobs.get_onchain_status", {
        jobId,
      });
      const status = requireObject(statusRaw);

      // Helper: read status code from response
      const readStatusCode = (): number | null => {
        const direct = status.statusCode ?? (status.raw as Record<string, unknown>)?.status;
        const n = Number(direct);
        return Number.isFinite(n) ? n : null;
      };

      const statusCode = readStatusCode();

      switch (op.kind) {
        case "completeJob": {
          // JobCompleted: status Completed (3)
          if (statusCode === 3) return { outcome: "confirmed" };
          // If still Submitted, the tx may not have landed
          if (statusCode === 2) {
            return { outcome: "unknown", error: "Job still Submitted — complete tx may not have landed" };
          }
          return { outcome: "failed", error: `Unexpected status: ${status.statusLabel ?? statusCode}` };
        }

        case "rejectJob": {
          // JobRejected: status Rejected (4)
          if (statusCode === 4) return { outcome: "confirmed" };
          // If still Submitted, the tx may not have landed
          if (statusCode === 2) {
            return { outcome: "unknown", error: "Job still Submitted — reject tx may not have landed" };
          }
          return { outcome: "failed", error: `Unexpected status: ${status.statusLabel ?? statusCode}` };
        }

        default:
          return { outcome: "unknown", error: `Unknown operation kind: ${op.kind}` };
      }
    } catch (err) {
      return { outcome: "unknown", error: `Postcondition check failed: ${err}` };
    }
  }

  // ── Poll Loop ──────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.state !== "running") return;

    try {
      if (this.activeEval) return;
      await this.pollSubmittedJobs();
    } catch (err) {
      console.error(`[evaluator-worker] Poll cycle error: ${err}`);
    }
  }

  // ── Submitted Job Loop ─────────────────────────────────────────────────

  private async pollSubmittedJobs(): Promise<void> {
    let jobs: unknown[];
    try {
      jobs = await this.listAssignedJobs("Submitted");
    } catch (err) {
      console.error(`[evaluator-worker] Failed to list Submitted jobs: ${err}`);
      return;
    }

    for (const job of jobs) {
      const jobRecord = job as Record<string, unknown>;
      const jobId = String(jobRecord.id ?? jobRecord.erc8183JobId ?? "");
      const erc8183JobId = String(jobRecord.erc8183JobId ?? "");

      if (!jobId || !erc8183JobId) continue;
      if (this.processedIds.has(jobId)) continue;

      this.activeEval = {
        jobId,
        erc8183JobId,
        phase: "discovered",
        startedAt: new Date(),
        retryCount: this.retryCounts.get(jobId) ?? 0,
      };

      try {
        await this.processSubmittedJob(jobRecord);
        this.processedIds.add(jobId);
        this.retryCounts.delete(jobId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[evaluator-worker] Job ${jobId} failed: ${msg}`);
        this.activeEval.phase = "failed";
        this.activeEval.lastError = msg;

        const nextRetry = (this.retryCounts.get(jobId) ?? 0) + 1;
        this.retryCounts.set(jobId, nextRetry);

        if (nextRetry >= this.workerConfig.maxRuntimeRetries) {
          // Runtime failure NEVER auto-rejects
          this.processedIds.add(jobId);
          this.emitManualReview(jobId, `Requires manual review after ${nextRetry} attempts: ${msg}`, { attempts: nextRetry });
          return;
        }

        const backoff = this.workerConfig.baseBackoffMs * Math.pow(2, nextRetry - 1);
        console.log(`[evaluator-worker] Retrying job ${jobId} in ${backoff}ms (attempt ${nextRetry})`);
        await this.sleep(backoff);
      } finally {
        this.activeEval = null;
      }
    }
  }

  private async processSubmittedJob(job: Record<string, unknown>): Promise<void> {
    const jobId = String(job.id ?? job.erc8183JobId ?? "");
    const erc8183JobId = String(job.erc8183JobId ?? "");

    // Verify evaluator address matches local wallet
    const evaluatorAddress = String(job.evaluatorAddress ?? "").toLowerCase();
    if (evaluatorAddress !== this.config.circleWalletAddress!.toLowerCase()) {
      console.log(`[evaluator-worker] Job ${jobId}: evaluator mismatch, skipping`);
      return;
    }

    // Step 1: Fetch deliverable via MCP
    this.activeEval!.phase = "verifying_hash";
    let deliverableData: Record<string, unknown>;
    try {
      const result = await this.mcp.callTool("evaluator.get_deliverable", {
        agentId: this.config.agentId,
        jobId: erc8183JobId,
        evaluatorAddress: this.config.circleWalletAddress,
      });
      deliverableData = requireObject(result);
    } catch (err) {
      throw new Error(`Failed to fetch deliverable: ${err}`);
    }

    const canonicalPayload = String(deliverableData.canonicalPayload ?? "");
    const storedHash = String(deliverableData.deliverableHash ?? "");
    const onchainHash = String(deliverableData.onchainDeliverableHash ?? "");
    const providerAgentId = String(deliverableData.providerAgentId ?? "");
    const providerAddress = String(job.providerAddress ?? "");

    // Step 2: Recompute Keccak-256 and verify three-way hash
    const computedHash = keccak256(toBytes(canonicalPayload));
    if (computedHash.toLowerCase() !== storedHash.toLowerCase()) {
      // Hash mismatch → manual review (never auto-reject)
      this.emitManualReview(jobId, `Hash mismatch (computed ${computedHash} != stored ${storedHash})`, { computedHash, storedHash });
      return;
    }

    // Verify onchain submitted hash matches stored hash
    if (onchainHash && onchainHash.toLowerCase() !== storedHash.toLowerCase()) {
      this.emitManualReview(jobId, `Onchain hash mismatch (onchain ${onchainHash} != stored ${storedHash})`, { onchainHash, storedHash });
      return;
    }

    // Step 3: Execute evaluator runtime
    this.activeEval!.phase = "executing_evaluation";
    this.emit("evaluation_started", { jobId });

    let runtimeResult: unknown;
    try {
      // Use evaluator runtime to evaluate the deliverable
      // The runtime checks acceptance criteria from the JobEnvelope
      runtimeResult = await this.runtime.run({
        taskId: `eval-${jobId}`,
        agentId: this.config.agentId,
        role: "evaluator" as const,
        protocol: "erc8183" as const,
        input: {
          jobId: erc8183JobId,
          deliverable: canonicalPayload,
          deliverableHash: storedHash,
        },
        metadata: { localJobId: jobId },
      });
    } catch (err) {
      // Runtime failure NEVER auto-rejects
      throw new Error(`Evaluator runtime failed: ${err}`);
    }

    // Step 4: Parse evaluation verdict
    this.activeEval!.phase = "evaluating";
    const outputStr = typeof runtimeResult === "string" ? runtimeResult : JSON.stringify(runtimeResult);
    const verdict = decodeEvaluationVerdict(outputStr);

    if (!verdict) {
      // Invalid verdict → manual review
      this.emitManualReview(jobId, "Invalid evaluation verdict");
      return;
    }

    // Verify evaluated hash matches
    if (!verifyEvaluatedHash(verdict, storedHash as Hex)) {
      this.emitManualReview(jobId, "Verdict hash mismatch");
      return;
    }

    // Step 5: Get mandatory criteria from JobEnvelope (not from verdict)
    const jobDescription = String(job.description ?? "");
    const envelope = decodeJobEnvelope(jobDescription);

    if (!envelope) {
      this.emitManualReview(jobId, "JobEnvelope missing or invalid");
      return;
    }

    const mandatoryCriteriaIds = envelope.acceptanceCriteria
      .filter((c) => c.mandatory)
      .map((c) => c.id);

    const decodedDeliverable = decodeDeliverable(canonicalPayload);
    if (!decodedDeliverable) {
      this.emitManualReview(jobId, "Canonical deliverable is invalid");
      return;
    }

    const action = determineSettlementAction(verdict, mandatoryCriteriaIds);

    // Persist evaluation before settlement
    this.activeEval!.phase = "settling";
    try {
      await this.mcp.callTool("evaluator.publish_evaluation", {
        agentId: this.config.agentId,
        jobId: erc8183JobId,
        evaluatorAddress: this.config.circleWalletAddress,
        deliverableHash: storedHash as `0x${string}`,
        verdict,
        evaluationReceiptHash: undefined,
      });
      this.emit("evaluation_published", { jobId, decision: action });
    } catch (err) {
      // Evaluation persistence failure → manual review
      this.emitManualReview(jobId, `Failed to persist evaluation: ${err}`);
      return;
    }

    switch (action) {
      case "auto_complete":
        await this.settleComplete(jobId, erc8183JobId, verdict, storedHash, providerAgentId, providerAddress);
        break;

      case "auto_reject":
        await this.settleReject(jobId, erc8183JobId, verdict, storedHash, providerAgentId, providerAddress);
        break;

      case "manual_review":
        this.emitManualReview(jobId, `Low confidence (${verdict.confidence}) or ambiguous evidence`, { confidence: verdict.confidence, score: verdict.score });
        break;
    }
  }

  // ── Settlement ─────────────────────────────────────────────────────────

  private async settleComplete(
    jobId: string,
    erc8183JobId: string,
    verdict: EvaluationVerdictV1,
    storedHash: string,
    providerAgentId: string,
    providerAddress: string,
  ): Promise<void> {
    try {
      const reasonHash = keccak256(toBytes(verdict.reason));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const completeResult = await this.services.completeJob({
        jobId: erc8183JobId,
        reason: reasonHash,
        optParams: "0x",
      }) as any;

      if (!completeResult?.ok) {
        throw new Error(String(completeResult?.error ?? completeResult?.reason ?? "completeJob failed"));
      }

      // Attach settlement tx — only use actual txHash, never operationId
      const settlementTxHash = String(completeResult.txHash ?? "");
      if (settlementTxHash && /^0x[a-fA-F0-9]{64}$/.test(settlementTxHash)) {
        try {
          await this.mcp.callTool("evaluator.attach_settlement_tx", {
            agentId: this.config.agentId,
            jobId: erc8183JobId,
            evaluatorAddress: this.config.circleWalletAddress,
            settlementTxHash,
          });
        } catch (err) {
          console.warn(`[evaluator] Failed to attach settlement tx: ${err}`);
        }
      } else {
        console.warn(`[evaluator] No valid txHash from completeJob, skipping settlement tx attachment`);
      }

      // Queue reputation for provider (successful_work)
      try {
        await this.mcp.callTool("evaluator.queue_reputation", {
          agentId: this.config.agentId,
          jobId: erc8183JobId,
          evaluatorAddress: this.config.circleWalletAddress,
          targetAgentId: providerAgentId,
          targetAddress: providerAddress,
          feedbackType: "successful_work",
          score: verdict.score,
          reason: verdict.reason,
          evidenceHash: storedHash,
        });
      } catch (err) {
        console.warn(`[evaluator] Failed to queue reputation: ${err}`);
      }

      this.activeEval!.phase = "completed";
      this.emit("evaluation_completed", { jobId, decision: "complete", score: verdict.score });
    } catch (err) {
      throw new Error(`completeJob failed: ${err}`);
    }
  }

  private async settleReject(
    jobId: string,
    erc8183JobId: string,
    verdict: EvaluationVerdictV1,
    storedHash: string,
    providerAgentId: string,
    providerAddress: string,
  ): Promise<void> {
    try {
      const reasonHash = keccak256(toBytes(verdict.reason));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rejectResult = await this.services.rejectJob({
        jobId: erc8183JobId,
        reason: reasonHash,
        optParams: "0x",
      }) as any;

      if (!rejectResult?.ok) {
        throw new Error(String(rejectResult?.error ?? rejectResult?.reason ?? "rejectJob failed"));
      }

      // Attach settlement tx — only use actual txHash, never operationId
      const settlementTxHash = String(rejectResult.txHash ?? "");
      if (settlementTxHash && /^0x[a-fA-F0-9]{64}$/.test(settlementTxHash)) {
        try {
          await this.mcp.callTool("evaluator.attach_settlement_tx", {
            agentId: this.config.agentId,
            jobId: erc8183JobId,
            evaluatorAddress: this.config.circleWalletAddress,
            settlementTxHash,
          });
        } catch (err) {
          console.warn(`[evaluator] Failed to attach settlement tx: ${err}`);
        }
      } else {
        console.warn(`[evaluator] No valid txHash from rejectJob, skipping settlement tx attachment`);
      }

      // Queue reputation for provider (failed_acceptance_criteria)
      try {
        await this.mcp.callTool("evaluator.queue_reputation", {
          agentId: this.config.agentId,
          jobId: erc8183JobId,
          evaluatorAddress: this.config.circleWalletAddress,
          targetAgentId: providerAgentId,
          targetAddress: providerAddress,
          feedbackType: "failed_acceptance_criteria",
          score: verdict.score,
          reason: verdict.reason,
          evidenceHash: storedHash,
        });
      } catch (err) {
        console.warn(`[evaluator] Failed to queue reputation: ${err}`);
      }

      this.activeEval!.phase = "rejected";
      this.emit("evaluation_completed", { jobId, decision: "reject", score: verdict.score });
    } catch (err) {
      throw new Error(`rejectJob failed: ${err}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async listAssignedJobs(status: string): Promise<unknown[]> {
    try {
      const result = await this.mcp.callTool("evaluator.list_assigned_jobs", {
        agentId: this.config.agentId,
        evaluatorAddress: this.config.circleWalletAddress,
        status,
        limit: 20,
      });
      const parsed = requireObject(result);
      return (parsed.jobs as unknown[]) ?? [];
    } catch (err) {
      console.error(`[evaluator-worker] MCP list_assigned_jobs failed: ${err}`);
      return [];
    }
  }

  private emitManualReview(jobId: string, reason: string, metadata: Record<string, unknown> = {}): void {
    this.activeEval!.phase = "manual_review";
    this.emit("evaluation.manual_review", { jobId, agentId: this.config.agentId, reason, ...metadata });
    console.warn("[arclayer:evaluator]", JSON.stringify({
      event: "evaluation.manual_review",
      jobId,
      agentId: this.config.agentId,
      phase: "manual_review",
      reason,
      ...metadata,
      timestamp: new Date().toISOString(),
    }));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createEvaluatorWorker(
  config: RunnerConfig,
  services: RunnerServices,
  mcp: ArcLayerMcpConnector,
  runtime: RuntimeConnector,
  workerConfig?: Partial<EvaluatorWorkerConfig>,
): EvaluatorWorker {
  const fullConfig: EvaluatorWorkerConfig = {
    pollIntervalMs: 15000,
    maxConcurrentJobs: 1,
    maxRuntimeRetries: 3,
    baseBackoffMs: 5000,
    ...workerConfig,
  };

  return new EvaluatorWorker(config, services, mcp, runtime, fullConfig);
}
