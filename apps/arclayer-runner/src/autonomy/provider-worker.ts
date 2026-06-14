/**
 * ProviderWorker — autonomous provider-side ERC-8183 lifecycle.
 *
 * Polls for Funded jobs assigned to the local wallet, dispatches to
 * runtime, publishes deliverable, and submits onchain.
 *
 * Builds ON TOP of:
 * - RunnerServices.runAndSubmitProviderJob / submitProviderDeliverable
 * - ArcChainReader (onchain verification)
 * - AutonomyStore (workflow persistence, lease management)
 * - RuntimeConnector (LLM execution)
 * - ArcLayerMcpConnector (job discovery)
 */
import {
  type AutonomousJobEnvelope,
  decodeJobEnvelope,
  JOB_STATUS,
  type RuntimeResult,
  type AgentTask,
} from "@arclayer/runner-core";
import type { ArcChainReader } from "../chain-reader";
import type { AutonomyStore } from "./autonomy-store";
import type { ProviderState } from "./types";
import type { RunnerServices } from "../services";
import type { RuntimeConnector } from "../runtime";
import type { ArcLayerMcpConnector } from "../mcp-connector";
import { createHash } from "node:crypto";

export type ProviderWorkerConfig = {
  pollIntervalMs: number;
  leaseMs: number;
  maxConcurrentJobs: number;
  allowLegacyPlainTextJobs: boolean;
};

export type ProviderWorkerHealth = {
  enabled: boolean;
  role: "provider";
  workerState: "starting" | "running" | "stopping" | "stopped";
  activeWorkflows: number;
  lastPollAt: string | null;
  lastError: string | null;
};

export class ProviderWorker {
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
    private readonly config: ProviderWorkerConfig
  ) {}

  /**
   * Start the autonomous polling loop.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.poll();
  }

  /**
   * Stop the polling loop gracefully.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Get worker health status.
   */
  getHealth(): ProviderWorkerHealth {
    return {
      enabled: true,
      role: "provider",
      workerState: this.running ? "running" : "stopped",
      activeWorkflows: this.activeCount,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
    };
  }

  /**
   * Run one poll cycle (for --once mode).
   */
  async pollOnce(): Promise<void> {
    await this.poll();
  }

  private async poll(): Promise<void> {
    if (!this.running) return;

    this.lastPollAt = new Date().toISOString();

    try {
      // Discover Funded jobs assigned to this provider
      const jobs = await this.discoverFundedJobs();

      for (const job of jobs) {
        if (this.activeCount >= this.config.maxConcurrentJobs) break;

        // Process job (non-blocking for concurrency)
        this.processJob(job).catch((err) => {
          this.lastError = err instanceof Error ? err.message : String(err);
          console.error(`[provider-worker] Error processing job ${job.id}:`, err);
        });
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error("[provider-worker] Poll error:", err);
    }

    // Schedule next poll
    if (this.running) {
      this.pollTimer = setTimeout(() => this.poll(), this.config.pollIntervalMs);
    }
  }

  /**
   * Discover Funded jobs assigned to this provider via MCP.
   */
  private async discoverFundedJobs(): Promise<Array<{ id: string; description: string; provider: string; evaluator: string; budget: string; expiredAt: string }>> {
    try {
      const result = await this.mcp.callTool("provider.list_assigned_jobs", {
        statuses: ["Funded"],
      });
      if (!result || typeof result !== "object") return [];
      const data = (result as any).jobs ?? (result as any).data ?? [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  /**
   * Process a single discovered job.
   */
  private async processJob(job: { id: string; description: string; provider: string; evaluator: string; budget: string; expiredAt: string }): Promise<void> {
    this.activeCount++;

    try {
      // Create or get workflow
      const { workflow, created } = this.store.createOrGetWorkflow({
        kind: "erc8183.provider",
        role: "provider",
        jobId: job.id,
        state: "DISCOVERED",
        payload: job,
      });

      // Skip if already terminal
      const terminalStates = ["SUBMITTED", "FAILED_FINAL", "TERMINAL_EXTERNAL"];
      if (terminalStates.includes(workflow.state)) {
        return;
      }

      // Claim lease
      const leaseOwner = `provider-${process.pid}`;
      const claimed = this.store.claimDueWorkflow("erc8183.provider", "provider", leaseOwner, this.config.leaseMs);
      if (!claimed || claimed.id !== workflow.id) {
        return; // Another worker has it
      }

      try {
        await this.executeJob(workflow.id, job);
      } finally {
        this.store.releaseLease(workflow.id);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.lastError = errMsg;
      console.error(`[provider-worker] Job ${job.id} failed:`, errMsg);
    } finally {
      this.activeCount--;
    }
  }

  /**
   * Execute the provider job lifecycle.
   */
  private async executeJob(workflowId: string, job: { id: string; description: string; provider: string; evaluator: string; budget: string; expiredAt: string }): Promise<void> {
    // ── VERIFYING ───────────────────────────────────────────────────────
    this.store.transition(workflowId, "VERIFYING");

    // Direct onchain verification
    const onchainJob = await this.chainReader.getJob(job.id);
    if (onchainJob.status !== JOB_STATUS.Funded) {
      this.store.transition(workflowId, "TERMINAL_EXTERNAL", { reason: `Status is ${onchainJob.status}, expected Funded` });
      return;
    }
    if (onchainJob.provider.toLowerCase() !== this.walletAddress.toLowerCase()) {
      this.store.transition(workflowId, "TERMINAL_EXTERNAL", { reason: "Provider mismatch" });
      return;
    }
    if (onchainJob.evaluator === "0x0000000000000000000000000000000000000000") {
      this.store.transition(workflowId, "FAILED_FINAL", { reason: "Evaluator is zero" });
      return;
    }
    if (Number(onchainJob.expiredAt) < Math.floor(Date.now() / 1000)) {
      this.store.transition(workflowId, "TERMINAL_EXTERNAL", { reason: "Job expired" });
      return;
    }

    // Decode job envelope
    const envelope = decodeJobEnvelope(onchainJob.description);
    if (!envelope && !this.config.allowLegacyPlainTextJobs) {
      this.store.transition(workflowId, "FAILED_FINAL", { reason: "Not a valid autonomous job envelope" });
      return;
    }

    // ── EXECUTION_STARTED ───────────────────────────────────────────────
    this.store.transition(workflowId, "EXECUTION_STARTED");
    this.store.appendEvent({
      workflowId,
      jobId: job.id,
      role: "provider",
      eventType: "execution.start",
      payload: { taskId: job.id },
    });

    // ── RUNTIME_RUNNING ─────────────────────────────────────────────────
    this.store.transition(workflowId, "RUNTIME_RUNNING");

    const task: AgentTask = {
      taskId: `provider-${job.id}`,
      agentId: "autonomous-provider",
      task: envelope?.task ?? onchainJob.description,
      input: envelope?.input,
      acceptanceCriteria: envelope?.acceptanceCriteria,
      outputFormat: envelope?.outputFormat,
      metadata: {
        jobId: job.id,
        role: "provider",
      },
    };

    const result = await this.runtime.run(task);

    // Handle runtime result
    if (result.status === "needs_payment") {
      // Delegate to x402 coordinator (will be implemented)
      this.store.transition(workflowId, "PAYMENT_REQUIRED", { paymentRequests: result.paymentRequests });
      this.store.appendEvent({
        workflowId,
        jobId: job.id,
        role: "provider",
        eventType: "payment.required",
        payload: { requests: result.paymentRequests },
      });
      // x402 coordinator will handle resume
      return;
    }

    if (result.status === "needs_action") {
      this.store.transition(workflowId, "FAILED_RETRYABLE", { reason: "Runtime needs manual action" });
      return;
    }

    if (result.status === "failed") {
      this.store.recordFailure(workflowId, "RUNTIME_FAILED", result.error ?? "Runtime failed", true);
      return;
    }

    // ── DELIVERABLE_READY ───────────────────────────────────────────────
    // Compute canonical deliverable hash
    const outputStr = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
    const deliverableHash = "0x" + createHash("sha256").update(outputStr).digest("hex") as string;

    this.store.transition(workflowId, "DELIVERABLE_READY", {
      deliverableHash,
      output: result.output,
    });

    this.store.appendEvent({
      workflowId,
      jobId: job.id,
      role: "provider",
      eventType: "deliverable.ready",
      payload: { deliverableHash },
    });

    // ── SUBMITTING ──────────────────────────────────────────────────────
    this.store.transition(workflowId, "SUBMITTING");

    const submitResult = await this.services.submitProviderDeliverable({
      jobId: job.id,
      deliverableHash: deliverableHash as `0x${string}`,
      result,
      optParams: "0x",
    });

    if (!submitResult.ok) {
      this.store.recordFailure(workflowId, "SUBMIT_FAILED", submitResult.error ?? "Submit failed", true);
      return;
    }

    // ── SUBMITTED ───────────────────────────────────────────────────────
    // Verify onchain status
    const submittedJob = await this.chainReader.getJob(job.id);
    if (submittedJob.status !== JOB_STATUS.Submitted) {
      this.store.recordFailure(workflowId, "POSTCONDITION_FAILED", `Expected Submitted, got ${submittedJob.status}`, true);
      return;
    }

    this.store.transition(workflowId, "SUBMITTED", {
      deliverableHash,
      submitTxHash: submitResult.result?.txHash,
      operationId: submitResult.operationId,
    });

    this.store.appendEvent({
      workflowId,
      jobId: job.id,
      role: "provider",
      eventType: "submit.done",
      payload: {
        deliverableHash,
        submitTxHash: submitResult.result?.txHash,
        status: "Submitted",
      },
    });
  }
}
