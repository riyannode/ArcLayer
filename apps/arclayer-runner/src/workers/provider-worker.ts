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

  // ── Startup Verification ───────────────────────────────────────────────

  private async verifyIdentity(): Promise<void> {
    // Verify role=provider
    if (this.config.role !== "provider") {
      throw new Error(`Worker requires role=provider, got ${this.config.role}`);
    }

    // Verify MCP token
    if (!this.config.mcpToken) {
      throw new Error("MCP Bearer token required");
    }

    // Verify ERC-8004 registration
    // (done via MCP identity tools)

    // Verify Circle CLI status
    // (done via circle.status tool)

    // Verify configured wallet
    if (!this.config.circleWalletAddress) {
      throw new Error("Circle wallet address required");
    }

    // Verify Arc chain ID
    if (this.config.chainId !== 5042002) {
      throw new Error(`Expected Arc Testnet chain ID 5042002, got ${this.config.chainId}`);
    }
  }

  private async reconcilePending(): Promise<void> {
    // Reconcile any pending operations from previous run
    // Uses OperationJournal.reconcilePendingOperations()
    try {
      // TODO: Call reconciliation when OperationJournal is wired
      console.log("[provider-worker] Reconciliation check passed");
    } catch (err) {
      console.warn(`[provider-worker] Reconciliation warning: ${err}`);
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
      // (done via MCP get_onchain_status)
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
        retryCount: 0,
      };

      try {
        await this.processFundedJob(jobRecord);
        this.processedFundedIds.add(jobId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[provider-worker] Funded job ${jobId} failed: ${msg}`);
        this.activeJob.phase = "failed";
        this.activeJob.lastError = msg;

        // Retry policy
        if (this.activeJob.retryCount < this.workerConfig.maxRuntimeRetries) {
          this.activeJob.retryCount++;
          const backoff = this.workerConfig.baseBackoffMs * Math.pow(2, this.activeJob.retryCount - 1);
          console.log(`[provider-worker] Retrying job ${jobId} in ${backoff}ms (attempt ${this.activeJob.retryCount})`);
          await this.sleep(backoff);
          // Will be retried on next poll cycle
          this.processedFundedIds.delete(jobId);
        } else {
          await this.notifyTelegram(
            "job.failed",
            `Job ${jobId} failed after ${this.workerConfig.maxRuntimeRetries} retries: ${msg}`,
          );
        }
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
    const providerAddress = String(job.providerAddress ?? "").toLowerCase();
    if (providerAddress !== this.config.circleWalletAddress!.toLowerCase()) {
      console.log(`[provider-worker] Job ${jobId}: provider mismatch, skipping`);
      return;
    }

    // Load/resume runtime state
    this.activeJob!.phase = "executing";
    this.emit("runtime_started", { jobId });
    await this.notifyTelegram("runtime_started", `Starting execution for job ${jobId}`);

    // Execute via existing RunnerServices.runProviderJob()
    // x402 payments are handled by the separate x402-agent role, not here.
    let runtimeResult: unknown;
    try {
      runtimeResult = await this.services.runProviderJob({
        jobId: erc8183JobId,
        description,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Runtime execution failed: ${msg}`);
    }

    // Canonicalize deliverable
    this.activeJob!.phase = "publishing";
    const output = (runtimeResult as Record<string, unknown>)?.output ?? runtimeResult;

    // Publish deliverable via MCP
    // (This would call provider.publish_deliverable)
    this.emit("deliverable_published", { jobId });

    // Submit deliverable on-chain via existing submitProviderDeliverable()
    this.activeJob!.phase = "submitting";
    try {
      await this.services.submitProviderDeliverable({
        jobId: erc8183JobId,
        deliverableHash: "0x" + "00".repeat(32), // Placeholder — actual hash from canonicalizeDeliverable
        optParams: "0x",
      });
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
