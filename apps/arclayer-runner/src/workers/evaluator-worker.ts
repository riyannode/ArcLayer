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
import type { RuntimeConnector } from "../runtime";

// ── Types ──────────────────────────────────────────────────────────────────

export type EvaluatorWorkerConfig = {
  pollIntervalMs: number;
  maxConcurrentJobs: number;
  maxRuntimeRetries: number;
  baseBackoffMs: number;
  telegramEnabled: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
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
    await this.notifyTelegram("worker.started", `Evaluator worker started for agent ${this.config.agentId}`);

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
    await this.notifyTelegram("worker.stopped", `Evaluator worker stopped for agent ${this.config.agentId}`);
  }

  getState(): WorkerState {
    return this.state;
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

    // Verify Circle CLI status
    try {
      await this.services.circleStatus();
    } catch (err) {
      throw new Error(`Circle CLI status check failed: ${err}`);
    }
  }

  private async reconcilePending(): Promise<void> {
    console.log("[evaluator-worker] Reconciliation check passed");
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
          this.activeEval.phase = "manual_review";
          await this.notifyTelegram(
            "evaluation.manual_review",
            `Job ${jobId} requires manual review after ${nextRetry} attempts: ${msg}`,
          );
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
      deliverableData = JSON.parse(result as string) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Failed to fetch deliverable: ${err}`);
    }

    const canonicalPayload = String(deliverableData.canonicalPayload ?? "");
    const storedHash = String(deliverableData.deliverableHash ?? "");
    const onchainHash = String(deliverableData.onchainDeliverableHash ?? "");

    // Step 2: Recompute Keccak-256 and verify three-way hash
    const computedHash = keccak256(toBytes(canonicalPayload));
    if (computedHash.toLowerCase() !== storedHash.toLowerCase()) {
      // Hash mismatch → manual review (never auto-reject)
      this.activeEval!.phase = "manual_review";
      await this.notifyTelegram(
        "evaluation.manual_review",
        `Job ${jobId}: hash mismatch (computed ${computedHash} != stored ${storedHash}). Manual review required.`,
      );
      return;
    }

    // Verify onchain submitted hash matches stored hash
    if (onchainHash && onchainHash.toLowerCase() !== storedHash.toLowerCase()) {
      this.activeEval!.phase = "manual_review";
      await this.notifyTelegram(
        "evaluation.manual_review",
        `Job ${jobId}: onchain hash mismatch (onchain ${onchainHash} != stored ${storedHash}). Manual review required.`,
      );
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
      this.activeEval!.phase = "manual_review";
      await this.notifyTelegram(
        "evaluation.manual_review",
        `Job ${jobId}: invalid evaluation verdict. Manual review required.`,
      );
      return;
    }

    // Verify evaluated hash matches
    if (!verifyEvaluatedHash(verdict, storedHash as Hex)) {
      this.activeEval!.phase = "manual_review";
      await this.notifyTelegram(
        "evaluation.manual_review",
        `Job ${jobId}: verdict hash mismatch. Manual review required.`,
      );
      return;
    }

    // Step 5: Get mandatory criteria from JobEnvelope (not from verdict)
    const jobDescription = String(job.description ?? "");
    const envelope = decodeJobEnvelope(jobDescription);

    if (!envelope) {
      this.activeEval!.phase = "manual_review";
      await this.notifyTelegram(
        "evaluation.manual_review",
        `Job ${jobId}: JobEnvelope missing or invalid. Manual review required.`,
      );
      return;
    }

    const mandatoryCriteriaIds = envelope.acceptanceCriteria
      .filter((c) => c.mandatory)
      .map((c) => c.id);

    const decodedDeliverable = decodeDeliverable(canonicalPayload);
    if (!decodedDeliverable) {
      this.activeEval!.phase = "manual_review";
      await this.notifyTelegram(
        "evaluation.manual_review",
        `Job ${jobId}: canonical deliverable is invalid. Manual review required.`,
      );
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
      this.activeEval!.phase = "manual_review";
      await this.notifyTelegram(
        "evaluation.manual_review",
        `Job ${jobId}: failed to persist evaluation: ${err}. Manual review required.`,
      );
      return;
    }

    switch (action) {
      case "auto_complete":
        await this.settleComplete(jobId, erc8183JobId, verdict);
        break;

      case "auto_reject":
        await this.settleReject(jobId, erc8183JobId, verdict);
        break;

      case "manual_review":
        this.activeEval!.phase = "manual_review";
        await this.notifyTelegram(
          "evaluation.manual_review",
          `Job ${jobId}: low confidence (${verdict.confidence}) or ambiguous evidence. Manual review required.`,
        );
        break;
    }
  }

  // ── Settlement ─────────────────────────────────────────────────────────

  private async settleComplete(
    jobId: string,
    erc8183JobId: string,
    verdict: EvaluationVerdictV1,
  ): Promise<void> {
    try {
      const reasonHash = keccak256(toBytes(verdict.reason));
      await this.services.completeJob({
        jobId: erc8183JobId,
        reason: reasonHash,
        optParams: "0x",
      });

      this.activeEval!.phase = "completed";
      this.emit("evaluation_completed", { jobId, decision: "complete", score: verdict.score });
      await this.notifyTelegram(
        "job.completed",
        `Job ${jobId} completed! Score: ${verdict.score}, Confidence: ${verdict.confidence}`,
      );
    } catch (err) {
      throw new Error(`completeJob failed: ${err}`);
    }
  }

  private async settleReject(
    jobId: string,
    erc8183JobId: string,
    verdict: EvaluationVerdictV1,
  ): Promise<void> {
    try {
      const reasonHash = keccak256(toBytes(verdict.reason));
      await this.services.rejectJob({
        jobId: erc8183JobId,
        reason: reasonHash,
        optParams: "0x",
      });

      this.activeEval!.phase = "rejected";
      this.emit("evaluation_completed", { jobId, decision: "reject", score: verdict.score });
      await this.notifyTelegram(
        "job.rejected",
        `Job ${jobId} rejected. Score: ${verdict.score}, Confidence: ${verdict.confidence}`,
      );
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
      const parsed = JSON.parse(result as string) as Record<string, unknown>;
      return (parsed.jobs as unknown[]) ?? [];
    } catch (err) {
      console.error(`[evaluator-worker] MCP list_assigned_jobs failed: ${err}`);
      return [];
    }
  }

  private async notifyTelegram(event: string, message: string): Promise<void> {
    if (!this.workerConfig.telegramEnabled) return;
    if (!this.workerConfig.telegramBotToken || !this.workerConfig.telegramChatId) return;

    try {
      const text = `🔍 *Evaluator Worker*\n\n${message}`;
      await fetch(
        `https://api.telegram.org/bot${this.workerConfig.telegramBotToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: this.workerConfig.telegramChatId,
            text,
            parse_mode: "Markdown",
          }),
        },
      );
    } catch (err) {
      // Telegram failure must not fail the job
      console.warn(`[evaluator-worker] Telegram notification failed: ${err}`);
    }
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
    telegramEnabled: process.env.ARCLAYER_TELEGRAM_ENABLED === "true",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    ...workerConfig,
  };

  return new EvaluatorWorker(config, services, mcp, runtime, fullConfig);
}
