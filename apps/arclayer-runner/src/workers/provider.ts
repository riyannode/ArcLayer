/**
 * Provider Worker — Autonomous ERC-8183 job processor.
 *
 * Discovers Open and Funded jobs, executes the full provider lifecycle:
 *   Open   → validate proposal → setBudget → notify client
 *   Funded → execute runtime → publish deliverable → submit
 *
 * Design:
 *   - 1 VPS = 1 role = 1 agentId = 1 wallet
 *   - Maximum concurrent jobs: 1
 *   - Retry policy: max 3 runtime retries, exponential backoff
 *   - Runtime failure never submits a deliverable
 *   - needs_action: checkpoint, stop job, alert, do NOT submit
 *   - Reuses existing RunnerServices (runProviderJob, submitProviderDeliverable)
 *   - Reuses existing ExecutionGateway, OperationJournal, CircleCliAdapter
 *
 * CLI:
 *   arclayer-runner provider-worker
 *   arclayer-runner provider-worker --once
 */

import { EventEmitter } from "node:events";
import type { RunnerConfig } from "@arclayer/runner-core";
import {
  isJobEnvelope,
  extractProposedBudget,
  parseUsdcToAtomic,
  hashDeliverable,
  RuntimeResultSchema,
} from "@arclayer/runner-core";
import type { RunnerServices } from "../services";
import type { ArcLayerMcpConnector } from "../mcp-connector";
import type { RuntimeConnector } from "../runtime";

// ── Types ──────────────────────────────────────────────────────────────────

export type ProviderWorkerConfig = {
  /** Poll interval in ms (default: 15000) */
  pollIntervalMs: number;
  /** Maximum concurrent jobs (default: 1) */
  maxConcurrentJobs: number;
  /** Maximum runtime retries per job (default: 3) */
  maxRuntimeRetries: number;
  /** Base backoff delay in ms (default: 5000) */
  baseBackoffMs: number;
  /** Enable Telegram notifications */
  telegramEnabled: boolean;
  /** Telegram bot token */
  telegramBotToken?: string;
  /** Telegram chat ID */
  telegramChatId?: string;
};

type WorkerState = "idle" | "running" | "stopping" | "stopped";

type JobPhase =
  | "discovered"
  | "validating"
  | "setting_budget"
  | "budget_set"
  | "executing"
  | "publishing"
  | "submitting"
  | "completed"
  | "failed"
  | "needs_action";

type ActiveJob = {
  jobId: string;
  erc8183JobId: string;
  phase: JobPhase;
  startedAt: Date;
  retryCount: number;
  lastError?: string;
};

// ── Provider Worker ────────────────────────────────────────────────────────

export class ProviderWorker extends EventEmitter {
  private state: WorkerState = "idle";
  private pollTimer?: ReturnType<typeof setInterval>;
  private activeJob: ActiveJob | null = null;
  private processedOpenIds = new Set<string>();
  private processedFundedIds = new Set<string>();
  private readonly retryCounts = new Map<string, number>();

  constructor(
    private readonly config: RunnerConfig,
    private readonly services: RunnerServices,
    private readonly mcp: ArcLayerMcpConnector,
    private readonly runtime: RuntimeConnector,
    private readonly workerConfig: ProviderWorkerConfig,
  ) {
    super();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.state !== "idle" && this.state !== "stopped") {
      throw new Error(`Cannot start worker in state ${this.state}`);
    }

    // Startup verification
    await this.verifyIdentity();
    await this.reconcilePending();

    this.state = "running";
    this.emit("worker.started", { agentId: this.config.agentId });

    await this.notifyTelegram("worker.started", `Provider worker started for agent ${this.config.agentId}`);

    // Start polling
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        console.error(`[provider-worker] Poll error: ${err.message}`);
      });
    }, this.workerConfig.pollIntervalMs);

    // Initial poll
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
    await this.notifyTelegram("worker.stopped", `Provider worker stopped for agent ${this.config.agentId}`);
  }

  getState(): WorkerState {
    return this.state;
  }

  getActiveJob(): ActiveJob | null {
    return this.activeJob;
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
    // Verify role=provider
    if (this.config.defaultRole !== "provider") {
      throw new Error(`Worker requires role=provider, got ${this.config.defaultRole}`);
    }

    // Verify MCP token
    if (!process.env.ARCLAYER_MCP_TOKEN) {
      throw new Error("ARCLAYER_MCP_TOKEN required");
    }

    // Verify configured wallet
    if (!this.config.circleWalletAddress) {
      throw new Error("Circle wallet address required");
    }

    // Verify Arc chain
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
    // Reconcile any pending operations from previous run
    try {
      const pendingOps = this.services.listReconcilableOperations();
      for (const op of pendingOps) {
        try {
          await this.services.reconcileOperation(
            op.operationId,
            "unknown",
            { errorMessage: "Reconciled on startup" },
          );
        } catch (err) {
          console.warn(`[provider] Reconciliation failed for ${op.operationId}: ${err}`);
        }
      }
      if (pendingOps.length > 0) {
        console.log(`[provider] Reconciled ${pendingOps.length} pending operations`);
      }
    } catch (err) {
      console.warn(`[provider] Reconciliation warning: ${err}`);
    }
  }

  // ── Poll Loop ──────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.state !== "running") return;

    try {
      // Skip if already processing a job
      if (this.activeJob) {
        return;
      }

      // 1. Check for Funded jobs first (execution priority)
      await this.pollFundedJobs();

      // 2. Then check for Open jobs (setBudget flow)
      if (!this.activeJob) {
        await this.pollOpenJobs();
      }
    } catch (err) {
      console.error(`[provider-worker] Poll cycle error: ${err}`);
    }
  }

  // ── Open Job Loop (setBudget flow) ─────────────────────────────────────

  private async pollOpenJobs(): Promise<void> {
    let jobs: unknown[];
    try {
      jobs = await this.listAssignedJobs("Open");
    } catch (err) {
      console.error(`[provider-worker] Failed to list Open jobs: ${err}`);
      return;
    }

    for (const job of jobs) {
      const jobRecord = job as Record<string, unknown>;
      const jobId = String(jobRecord.id ?? jobRecord.erc8183JobId ?? "");
      const erc8183JobId = String(jobRecord.erc8183JobId ?? "");

      if (!jobId || !erc8183JobId) continue;
      if (this.processedOpenIds.has(jobId)) continue;

      this.activeJob = {
        jobId,
        erc8183JobId,
        phase: "discovered",
        startedAt: new Date(),
        retryCount: 0,
      };

      try {
        await this.processOpenJob(jobRecord);
        this.processedOpenIds.add(jobId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[provider-worker] Open job ${jobId} failed: ${msg}`);
        this.activeJob.phase = "failed";
        this.activeJob.lastError = msg;
        await this.notifyTelegram("job.failed", `Open job ${jobId} failed: ${msg}`);
      } finally {
        this.activeJob = null;
      }
    }
  }

  private async processOpenJob(job: Record<string, unknown>): Promise<void> {
    const jobId = String(job.id ?? job.erc8183JobId ?? "");
    const erc8183JobId = String(job.erc8183JobId ?? "");
    const description = String(job.description ?? "");

    this.activeJob!.phase = "validating";

    // Verify on-chain provider equals local wallet
    const providerAddress = String(job.providerAddress ?? "").toLowerCase();
    if (providerAddress !== this.config.circleWalletAddress!.toLowerCase()) {
      console.log(`[provider-worker] Job ${jobId}: provider mismatch, skipping`);
      return;
    }

    // Decode JobEnvelope if present
    let proposedBudget: string | null = null;
    if (isJobEnvelope(description)) {
      proposedBudget = extractProposedBudget(description);
    }

    // If no envelope, use the job's proposed budget from the description
    if (!proposedBudget) {
      proposedBudget = String(job.proposedBudget ?? job.priceAtomic ?? "");
      if (proposedBudget) {
        // Convert from atomic to USDC if needed
        const atomic = Number(proposedBudget);
        if (atomic > 1000000) {
          // Likely atomic units, convert
          proposedBudget = (atomic / 1_000_000).toFixed(6);
        }
      }
    }

    if (!proposedBudget || proposedBudget === "0") {
      console.log(`[provider-worker] Job ${jobId}: no proposed budget, skipping`);
      return;
    }

    // Enforce provider budget policy
    // (e.g., minimum budget, maximum budget, allowed task types)

    this.activeJob!.phase = "setting_budget";

    // Call existing setBudget via RunnerServices
    try {
      const result = await this.services.setBudget({
        jobId: erc8183JobId,
        amount: proposedBudget,
        optParams: "0x",
      });

      this.activeJob!.phase = "budget_set";
      this.emit("job_budget_set", { jobId, budget: proposedBudget });
      await this.notifyTelegram(
        "job_budget_set",
        `Budget set to ${proposedBudget} USDC for job ${jobId}`,
      );

      // Verify on-chain budget equals proposal
      const statusRaw = await this.mcp.callTool("jobs.get_onchain_status", {
        jobId: erc8183JobId,
      });
      const status = JSON.parse(statusRaw as string) as Record<string, unknown>;
      const expectedAtomic = parseUsdcToAtomic(proposedBudget);

      if (String(status.budget ?? "") !== expectedAtomic.toString()) {
        throw new Error(
          `On-chain budget mismatch: expected ${expectedAtomic}, got ${status.budget}`,
        );
      }

      if (
        status.provider &&
        String(status.provider).toLowerCase() !==
          this.config.circleWalletAddress!.toLowerCase()
      ) {
        throw new Error("On-chain provider changed after setBudget");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`setBudget failed: ${msg}`);
    }
  }

  // ── Funded Job Loop (execution flow) ───────────────────────────────────

  private async pollFundedJobs(): Promise<void> {
    let jobs: unknown[];
    try {
      jobs = await this.listAssignedJobs("Funded");
    } catch (err) {
      console.error(`[provider-worker] Failed to list Funded jobs: ${err}`);
      return;
    }

    for (const job of jobs) {
      const jobRecord = job as Record<string, unknown>;
      const jobId = String(jobRecord.id ?? jobRecord.erc8183JobId ?? "");
      const erc8183JobId = String(jobRecord.erc8183JobId ?? "");

      if (!jobId || !erc8183JobId) continue;
      if (this.processedFundedIds.has(jobId)) continue;

      this.activeJob = {
        jobId,
        erc8183JobId,
        phase: "discovered",
        startedAt: new Date(),
        retryCount: this.retryCounts.get(jobId) ?? 0,
      };

      try {
        await this.processFundedJob(jobRecord);
        this.processedFundedIds.add(jobId);
        this.retryCounts.delete(jobId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[provider-worker] Funded job ${jobId} failed: ${msg}`);
        this.activeJob.phase = "failed";
        this.activeJob.lastError = msg;

        const nextRetry = (this.retryCounts.get(jobId) ?? 0) + 1;
        this.retryCounts.set(jobId, nextRetry);

        if (nextRetry >= this.workerConfig.maxRuntimeRetries) {
          this.processedFundedIds.add(jobId);
          await this.notifyTelegram(
            "job.failed",
            `Job ${jobId} failed after ${nextRetry} attempts: ${msg}`,
          );
          return;
        }

        const backoff = this.workerConfig.baseBackoffMs * Math.pow(2, nextRetry - 1);
        console.log(`[provider-worker] Retrying job ${jobId} in ${backoff}ms (attempt ${nextRetry})`);
        await this.sleep(backoff);
      } finally {
        this.activeJob = null;
      }
    }
  }

  private async processFundedJob(job: Record<string, unknown>): Promise<void> {
    const jobId = String(job.id ?? job.erc8183JobId ?? "");
    const erc8183JobId = String(job.erc8183JobId ?? "");
    const description = String(job.description ?? "");

    // Verify on-chain provider equals local wallet
    const assignedProviderAddress = String(job.providerAddress ?? "").toLowerCase();
    const configuredProviderAddress = this.config.circleWalletAddress;

    if (!configuredProviderAddress) {
      throw new Error("Circle wallet address required");
    }

    if (assignedProviderAddress !== configuredProviderAddress.toLowerCase()) {
      console.log(`[provider-worker] Job ${jobId}: provider mismatch, skipping`);
      return;
    }

    // Load/resume runtime state
    this.activeJob!.phase = "executing";
    this.emit("runtime_started", { jobId });
    await this.notifyTelegram("runtime_started", `Starting execution for job ${jobId}`);

    const evaluatorAddress = String(job.evaluatorAddress ?? job.evaluator ?? "");

    if (!/^0x[a-fA-F0-9]{40}$/.test(evaluatorAddress)) {
      throw new Error(`Job ${jobId} has an invalid evaluator address`);
    }

    const taskId = `provider:${erc8183JobId}:${Date.now()}`;

    // Execute via existing RunnerServices.runProviderJob()
    let runResult: Record<string, unknown>;
    try {
      runResult = (await this.services.runProviderJob({
        taskId,
        jobId: erc8183JobId,
        agentId: this.config.agentId,
        provider: configuredProviderAddress,
        evaluator: evaluatorAddress,
        description,
        input: { description, jobEnvelope: description },
        metadata: { localJobId: jobId },
      })) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Runtime execution failed: ${msg}`);
    }

    // Check if runtime needs paid resources
    // Provider does NOT pay — it checkpoints and waits for x402-agent
    if (runResult?.state === "needs_payment") {
      this.activeJob!.phase = "needs_action";
      const paymentRequests = runResult.paymentRequests;
      this.emit("needs_payment", { jobId, paymentRequests });
      await this.notifyTelegram(
        "runtime.needs_action",
        `Job ${jobId} needs paid resources. Waiting for x402-agent to complete payment.`,
      );
      return;
    }

    if (!runResult.ok || runResult.status !== "completed") {
      throw new Error(
        String(runResult.error ?? `Runtime did not complete: ${String(runResult.status)}`),
      );
    }

    // Build canonical deliverable and compute real hash
    this.activeJob!.phase = "publishing";

    // Parse the runtime result into the proper RuntimeResult type
    const runtimeResult = RuntimeResultSchema.parse(runResult.result ?? runResult);

    const runtimeOutput = runtimeResult.output ?? null;
    const runtimeArtifacts = runtimeResult.artifacts;

    const deliverable = {
      schema: "arclayer.deliverable" as const,
      version: 1 as const,
      jobId: erc8183JobId,
      providerAgentId: this.config.agentId,
      output: runtimeOutput,
      artifacts: runtimeArtifacts,
      runtime: {
        taskId,
        completedAt: new Date().toISOString(),
      },
    };

    const { canonicalPayload, deliverableHash } = hashDeliverable(deliverable);

    // Publish deliverable via MCP
    await this.mcp.callTool("provider.publish_deliverable", {
      agentId: this.config.agentId,
      jobId: erc8183JobId,
      providerAddress: configuredProviderAddress,
      canonicalPayload,
      deliverableHash,
      artifacts: runtimeArtifacts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runtimeReceiptHash: (runResult as any).receipt?.proof?.sha256 ?? undefined,
    });
    this.emit("deliverable_published", { jobId, deliverableHash });

    // Submit deliverable on-chain via existing submitProviderDeliverable()
    this.activeJob!.phase = "submitting";
    try {
      const submitResult = await this.services.submitProviderDeliverable({
        jobId: erc8183JobId,
        deliverableHash,
        result: runtimeResult,
        optParams: "0x",
      });
      if (submitResult && !submitResult.ok) {
        throw new Error(String(submitResult.error ?? "Provider deliverable submission failed"));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Submit failed: ${msg}`);
    }

    this.activeJob!.phase = "completed";
    this.emit("job_submitted", { jobId });
    await this.notifyTelegram("job_submitted", `Job ${jobId} submitted successfully`);

    // Complete runtime checkpoint
    this.emit("runtime_completed", { jobId });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async listAssignedJobs(status: string): Promise<unknown[]> {
    // Use MCP tool to list assigned jobs
    try {
      const result = await this.mcp.callTool(
        "provider.list_assigned_jobs_extended",
        {
          agentId: this.config.agentId,
          providerAddress: this.config.circleWalletAddress,
          status,
          limit: 20,
        },
      );
      const parsed = JSON.parse(result as string) as Record<string, unknown>;
      return (parsed.jobs as unknown[]) ?? [];
    } catch (err) {
      console.error(`[provider-worker] MCP list_assigned_jobs failed: ${err}`);
      return [];
    }
  }

  private async notifyTelegram(event: string, message: string): Promise<void> {
    if (!this.workerConfig.telegramEnabled) return;
    if (!this.workerConfig.telegramBotToken || !this.workerConfig.telegramChatId) return;

    try {
      const text = `🤖 *Provider Worker*\n\n${message}`;
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
      console.warn(`[provider-worker] Telegram notification failed: ${err}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createProviderWorker(
  config: RunnerConfig,
  services: RunnerServices,
  mcp: ArcLayerMcpConnector,
  runtime: RuntimeConnector,
  workerConfig?: Partial<ProviderWorkerConfig>,
): ProviderWorker {
  const fullConfig: ProviderWorkerConfig = {
    pollIntervalMs: 15000,
    maxConcurrentJobs: 1,
    maxRuntimeRetries: 3,
    baseBackoffMs: 5000,
    telegramEnabled: process.env.ARCLAYER_TELEGRAM_ENABLED === "true",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    ...workerConfig,
  };

  return new ProviderWorker(config, services, mcp, runtime, fullConfig);
}
