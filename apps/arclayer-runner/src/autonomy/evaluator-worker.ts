/**
 * EvaluatorWorker — autonomous evaluator-side ERC-8183 lifecycle.
 *
 * Discovers Submitted jobs where evaluator == local wallet,
 * fetches deliverable, verifies hash, dispatches evaluation,
 * and completes or rejects onchain.
 *
 * Builds ON TOP of:
 * - RunnerServices.completeJob / rejectJob
 * - ArcChainReader (onchain verification)
 * - AutonomyStore (workflow persistence)
 * - RuntimeConnector (evaluation dispatch)
 * - ArcLayerMcpConnector (deliverable fetch)
 */
import {
  type EvaluationVerdict,
  EvaluationVerdictSchema,
  JOB_STATUS,
  type AgentTask,
} from "@arclayer/runner-core";
import type { ArcChainReader } from "../chain-reader";
import type { AutonomyStore } from "./autonomy-store";
import type { EvaluatorState } from "./types";
import type { RunnerServices } from "../services";
import type { RuntimeConnector } from "../runtime";
import type { ArcLayerMcpConnector } from "../mcp-connector";
import { createHash } from "node:crypto";

export type EvaluatorWorkerConfig = {
  pollIntervalMs: number;
  leaseMs: number;
  maxConcurrentJobs: number;
  completeThreshold: number;
  manualReviewThreshold: number;
};

export type EvaluatorWorkerHealth = {
  enabled: boolean;
  role: "evaluator";
  workerState: "starting" | "running" | "stopping" | "stopped";
  activeWorkflows: number;
  lastPollAt: string | null;
  lastError: string | null;
};

export class EvaluatorWorker {
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPollAt: string | null = null;
  private lastError: string | null = null;
  private activeCount = 0;

  constructor(
    private readonly services: RunnerServices,
    private readonly chainReader: ArcChainReader,
    private readonly store: AutonomyStore,
    private readonly runtime: RuntimeConnector,
    private readonly mcp: ArcLayerMcpConnector,
    private readonly walletAddress: string,
    private readonly config: EvaluatorWorkerConfig
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getHealth(): EvaluatorWorkerHealth {
    return {
      enabled: true,
      role: "evaluator",
      workerState: this.running ? "running" : "stopped",
      activeWorkflows: this.activeCount,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
    };
  }

  async pollOnce(): Promise<void> {
    await this.poll();
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    this.lastPollAt = new Date().toISOString();

    try {
      const jobs = await this.discoverSubmittedJobs();
      for (const job of jobs) {
        if (this.activeCount >= this.config.maxConcurrentJobs) break;
        this.processJob(job).catch((err) => {
          this.lastError = err instanceof Error ? err.message : String(err);
          console.error(`[evaluator-worker] Error processing job ${job.id}:`, err);
        });
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error("[evaluator-worker] Poll error:", err);
    }

    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.config.pollIntervalMs);
    }
  }

  /**
   * Discover Submitted jobs where evaluator == local wallet.
   */
  private async discoverSubmittedJobs(): Promise<Array<{ id: string; description: string; provider: string; evaluator: string }>> {
    try {
      const result = await this.mcp.listPublicJobs({
        status: "submitted",
        evaluatorAddress: this.walletAddress,
        limit: this.config.maxConcurrentJobs,
      });
      if (!result || typeof result !== "object") return [];
      const data = (result as any).jobs ?? (result as any).data ?? [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private async processJob(job: { id: string; description: string; provider: string; evaluator: string }): Promise<void> {
    this.activeCount++;

    try {
      const { workflow } = this.store.createOrGetWorkflow({
        kind: "erc8183.evaluator",
        role: "evaluator",
        jobId: job.id,
        state: "DISCOVERED",
        payload: job,
      });

      const terminalStates = ["COMPLETED", "REJECTED", "MANUAL_REVIEW", "FAILED_FINAL", "TERMINAL_EXTERNAL"];
      if (terminalStates.includes(workflow.state)) return;

      const leaseOwner = `evaluator-${process.pid}`;
      const claimed = this.store.claimDueWorkflow("erc8183.evaluator", "evaluator", leaseOwner, this.config.leaseMs);
      if (!claimed || claimed.id !== workflow.id) return;

      try {
        await this.executeEvaluation(workflow.id, job);
      } finally {
        this.store.releaseLease(workflow.id);
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.activeCount--;
    }
  }

  private async executeEvaluation(workflowId: string, job: { id: string; description: string; provider: string; evaluator: string }): Promise<void> {
    // ── VERIFYING ───────────────────────────────────────────────────────
    this.store.transition(workflowId, "VERIFYING");

    const onchainJob = await this.chainReader.getJob(job.id);
    if (onchainJob.status !== JOB_STATUS.Submitted) {
      this.store.transition(workflowId, "TERMINAL_EXTERNAL", { reason: `Status is ${onchainJob.status}, expected Submitted` });
      return;
    }
    if (onchainJob.evaluator.toLowerCase() !== this.walletAddress.toLowerCase()) {
      this.store.transition(workflowId, "TERMINAL_EXTERNAL", { reason: "Evaluator mismatch" });
      return;
    }
    if (onchainJob.provider === "0x0000000000000000000000000000000000000000") {
      this.store.transition(workflowId, "FAILED_FINAL", { reason: "Provider is zero" });
      return;
    }

    // ── FETCHING_DELIVERABLE ────────────────────────────────────────────
    this.store.transition(workflowId, "FETCHING_DELIVERABLE");

    // Fetch from shared deliverable storage via MCP
    let deliverable: { payload: unknown; deliverableHash: string; integrityValid: boolean } | null = null;
    try {
      const result = await this.mcp.callTool("evaluator.get_deliverable", { jobId: job.id });
      deliverable = result as any;
    } catch {
      // Fallback: try direct MCP connector
    }

    if (!deliverable) {
      this.store.transition(workflowId, "FAILED_RETRYABLE", { reason: "Could not fetch deliverable" });
      return;
    }

    // ── DELIVERABLE_VERIFIED ────────────────────────────────────────────
    // Verify hash integrity
    const payloadStr = typeof deliverable.payload === "string" ? deliverable.payload : JSON.stringify(deliverable.payload);
    const localHash = "0x" + createHash("sha256").update(payloadStr).digest("hex");

    if (localHash.toLowerCase() !== deliverable.deliverableHash.toLowerCase()) {
      // Hash mismatch → manual review, never auto-complete
      this.store.transition(workflowId, "MANUAL_REVIEW", {
        reason: "Deliverable hash mismatch",
        expected: deliverable.deliverableHash,
        computed: localHash,
      });
      this.store.appendEvent({
        workflowId,
        jobId: job.id,
        role: "evaluator",
        eventType: "hash.mismatch",
        payload: { expected: deliverable.deliverableHash, computed: localHash },
      });
      return;
    }

    if (!deliverable.integrityValid) {
      this.store.transition(workflowId, "MANUAL_REVIEW", { reason: "Deliverable integrity check failed" });
      return;
    }

    this.store.transition(workflowId, "DELIVERABLE_VERIFIED");

    // ── EVALUATION_RUNNING ──────────────────────────────────────────────
    this.store.transition(workflowId, "EVALUATION_RUNNING");

    // Parse acceptance criteria from job description
    let acceptanceCriteria: string[] = [];
    try {
      const envelope = JSON.parse(onchainJob.description);
      acceptanceCriteria = envelope.acceptanceCriteria ?? [];
    } catch {
      // Legacy plain text — no structured criteria
    }

    const evalTask: AgentTask = {
      taskId: `evaluator-${job.id}`,
      agentId: "autonomous-evaluator",
      task: `Evaluate the following deliverable against the acceptance criteria.

DELIVERABLE:
${payloadStr}

ACCEPTANCE CRITERIA:
${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Respond with a JSON object matching this schema:
{
  "decision": "complete" | "reject" | "manual_review",
  "score": 0-100,
  "reason": "explanation",
  "evidence": [{"criterion": "...", "passed": true/false, "detail": "..."}],
  "evaluatedDeliverableHash": "${deliverable.deliverableHash}"
}`,
      outputFormat: "json",
      metadata: { jobId: job.id, role: "evaluator" },
    };

    const result = await this.runtime.run(evalTask);

    // ── VERDICT_READY ───────────────────────────────────────────────────
    let verdict: EvaluationVerdict;
    try {
      const outputStr = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
      const parsed = JSON.parse(outputStr);
      verdict = EvaluationVerdictSchema.parse(parsed);
    } catch (err) {
      this.store.recordFailure(workflowId, "MALFORMED_VERDICT", `Evaluation output failed validation: ${err}`, true);
      return;
    }

    // Ensure evaluated hash matches
    if (verdict.evaluatedDeliverableHash.toLowerCase() !== deliverable.deliverableHash.toLowerCase()) {
      this.store.transition(workflowId, "MANUAL_REVIEW", {
        reason: "Evaluated hash does not match deliverable hash",
      });
      return;
    }

    this.store.transition(workflowId, "VERDICT_READY", { verdict });

    // ── Policy decision ─────────────────────────────────────────────────
    if (verdict.decision === "manual_review") {
      this.store.transition(workflowId, "MANUAL_REVIEW", { verdict });
      this.store.appendEvent({
        workflowId,
        jobId: job.id,
        role: "evaluator",
        eventType: "verdict.manual_review",
        payload: { score: verdict.score, reason: verdict.reason },
      });
      return;
    }

    if (verdict.decision === "reject" || verdict.score < this.config.manualReviewThreshold) {
      // Reject
      this.store.transition(workflowId, "REJECTING");

      // Compute reason hash for onchain storage
      const reasonHash = "0x" + createHash("sha256").update(JSON.stringify({
        reason: verdict.reason,
        evidence: verdict.evidence,
        score: verdict.score,
      })).digest("hex") as `0x${string}`;

      const rejectResult = await this.services.rejectJob({
        jobId: job.id,
        reasonHash,
        idempotencyKey: `evaluator:${job.id}:reject`,
      });

      if (!rejectResult.ok) {
        this.store.recordFailure(workflowId, "REJECT_FAILED", rejectResult.error ?? "Reject failed", true);
        return;
      }

      // Verify onchain
      const rejectedJob = await this.chainReader.getJob(job.id);
      if (rejectedJob.status !== JOB_STATUS.Rejected) {
        this.store.recordFailure(workflowId, "POSTCONDITION_FAILED", `Expected Rejected, got ${rejectedJob.status}`, true);
        return;
      }

      this.store.transition(workflowId, "REJECTED", {
        verdict,
        rejectTxHash: rejectResult.result?.txHash,
        operationId: rejectResult.operationId,
      });
      this.store.appendEvent({
        workflowId,
        jobId: job.id,
        role: "evaluator",
        eventType: "reject.done",
        payload: { status: "Rejected", score: verdict.score },
      });
      return;
    }

    if (verdict.decision === "complete" && verdict.score >= this.config.completeThreshold) {
      // Check all mandatory criteria passed
      const allCriteriaPassed = verdict.evidence.every((e) => e.passed);
      if (!allCriteriaPassed) {
        this.store.transition(workflowId, "MANUAL_REVIEW", {
          reason: "Not all criteria passed despite high score",
          verdict,
        });
        return;
      }

      // Complete
      this.store.transition(workflowId, "COMPLETING");

      const reasonHash = "0x" + createHash("sha256").update(JSON.stringify({
        reason: verdict.reason,
        evidence: verdict.evidence,
        score: verdict.score,
      })).digest("hex") as `0x${string}`;

      const completeResult = await this.services.completeJob({
        jobId: job.id,
        reasonHash,
        idempotencyKey: `evaluator:${job.id}:complete`,
      });

      if (!completeResult.ok) {
        this.store.recordFailure(workflowId, "COMPLETE_FAILED", completeResult.error ?? "Complete failed", true);
        return;
      }

      // Verify onchain
      const completedJob = await this.chainReader.getJob(job.id);
      if (completedJob.status !== JOB_STATUS.Completed) {
        this.store.recordFailure(workflowId, "POSTCONDITION_FAILED", `Expected Completed, got ${completedJob.status}`, true);
        return;
      }

      this.store.transition(workflowId, "COMPLETED", {
        verdict,
        completeTxHash: completeResult.result?.txHash,
        operationId: completeResult.operationId,
      });
      this.store.appendEvent({
        workflowId,
        jobId: job.id,
        role: "evaluator",
        eventType: "complete.done",
        payload: { status: "Completed", score: verdict.score },
      });
      return;
    }

    // Fallback: manual review
    this.store.transition(workflowId, "MANUAL_REVIEW", {
      reason: "Verdict did not meet any automated decision threshold",
      verdict,
    });
  }
}
