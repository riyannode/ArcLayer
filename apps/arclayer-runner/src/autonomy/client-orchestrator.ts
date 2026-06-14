/**
 * ClientOrchestrator — autonomous client-side ERC-8183 lifecycle.
 *
 * High-level state machine that creates, budgets, approves, and funds
 * a job in one call. Resumable from any intermediate state.
 *
 * Builds ON TOP of existing primitives:
 * - RunnerServices.createJob / setBudget / approveUsdcForErc8183 / fundJob
 * - ExecutionGateway (idempotency, wallet locks)
 * - ArcChainReader (onchain verification)
 * - AutonomyStore (workflow persistence)
 */
import {
  type AutonomousJobEnvelope,
  encodeJobEnvelope,
  decimalToMicros,
  ZERO_ADDRESS,
  CONTRACTS,
  type OperationExpectation,
} from "@arclayer/runner-core";
import type { ArcChainReader } from "../chain-reader";
import type { AutonomyStore } from "./autonomy-store";
import type { ClientState } from "./types";
import type { RunnerServices } from "../services";

export type ClientCreateAndFundInput = {
  requestId: string;
  task: string;
  input?: unknown;
  acceptanceCriteria: string[];
  outputFormat?: "text" | "json" | "markdown";
  budgetUsdc: string;
  provider: string;
  evaluator: string;
  expiresInSeconds?: number;
  x402?: {
    allowed?: boolean;
    maxSpendUsdc?: string;
    allowedHosts?: string[];
  };
};

export type ClientCreateAndFundOutput = {
  ok: true;
  requestId: string;
  workflowId: string;
  jobId: string;
  status: "Funded";
  budgetUsdc: string;
  budgetAtomic: string;
  provider: string;
  evaluator: string;
  operations: {
    createJob: { operationId: string; txHash?: string };
    setBudget: { operationId: string; txHash?: string };
    approveUsdc: { operationId: string; txHash?: string };
    fundJob: { operationId: string; txHash?: string };
  };
};

export class ClientOrchestrator {
  constructor(
    private readonly services: RunnerServices,
    private readonly chainReader: ArcChainReader,
    private readonly store: AutonomyStore,
    private readonly walletAddress: string
  ) {}

  /**
   * Create and fund a job in one call. Resumable from any intermediate state.
   */
  async createAndFund(input: ClientCreateAndFundInput): Promise<ClientCreateAndFundOutput> {
    // ── VALIDATING ──────────────────────────────────────────────────────
    this.validateInput(input);

    // ── Get or create workflow ──────────────────────────────────────────
    const { workflow, created } = this.store.createOrGetWorkflow({
      kind: "erc8183.client_create_and_fund",
      role: "client",
      requestId: input.requestId,
      state: "RECEIVED",
      payload: input,
    });

    if (!created) {
      // Resume from last confirmed state
      const existing = workflow.result as ClientCreateAndFundOutput | undefined;
      if (existing?.ok && existing.status === "Funded") {
        return existing; // Already done
      }
    }

    // Transition to VALIDATING
    if (workflow.state === "RECEIVED") {
      this.store.transition(workflow.id, "VALIDATING");
    }

    // ── Encode job envelope ─────────────────────────────────────────────
    const envelope: AutonomousJobEnvelope = {
      version: 1,
      type: "arclayer.autonomous-job",
      task: input.task,
      input: input.input,
      acceptanceCriteria: input.acceptanceCriteria,
      outputFormat: input.outputFormat ?? "text",
      x402: {
        allowed: input.x402?.allowed ?? false,
        maxSpendUsdc: input.x402?.maxSpendUsdc ?? "0",
        allowedHosts: input.x402?.allowedHosts ?? [],
      },
      metadata: {},
    };
    const description = encodeJobEnvelope(envelope);

    // ── Calculate expiry ────────────────────────────────────────────────
    const expiresInSeconds = input.expiresInSeconds ?? 3600;
    const expiredAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

    // ── Convert budget ──────────────────────────────────────────────────
    const budgetAtomic = decimalToMicros(input.budgetUsdc);

    // ── Operations tracking ─────────────────────────────────────────────
    const ops = {
      createJob: { operationId: "", txHash: undefined as string | undefined },
      setBudget: { operationId: "", txHash: undefined as string | undefined },
      approveUsdc: { operationId: "", txHash: undefined as string | undefined },
      fundJob: { operationId: "", txHash: undefined as string | undefined },
    };

    let jobId = "";

    try {
      // ── CREATING_JOB ──────────────────────────────────────────────────
      if (this.shouldRunPhase(workflow.state, "CREATING_JOB")) {
        this.store.transition(workflow.id, "CREATING_JOB");
        this.store.appendEvent({
          workflowId: workflow.id,
          role: "client",
          eventType: "createJob.start",
          payload: { provider: input.provider, evaluator: input.evaluator },
        });

        const createResult = await this.services.createJob({
          provider: input.provider,
          evaluator: input.evaluator,
          expiredAt,
          description,
          hook: ZERO_ADDRESS,
          idempotencyKey: `client:${input.requestId}:createJob`,
          requestId: input.requestId,
        });

        if (!createResult.ok) throw new Error(`createJob failed: ${JSON.stringify(createResult)}`);

        ops.createJob.operationId = createResult.operationId ?? "";
        ops.createJob.txHash = createResult.result?.txHash;

        // Resolve jobId from receipt
        if (ops.createJob.txHash) {
          const resolved = await this.chainReader.resolveCreatedJobId(
            ops.createJob.txHash as `0x${string}`
          );
          if (resolved) jobId = resolved;
        }

        // Store jobId in workflow payload for resume
        this.store.transition(workflow.id, "JOB_CREATED", { jobId, ops: { createJob: ops.createJob } });
        this.store.appendEvent({
          workflowId: workflow.id,
          jobId,
          role: "client",
          eventType: "createJob.done",
          payload: { jobId, operationId: ops.createJob.operationId },
        });
      }

      // Get jobId from workflow result if resuming
      if (!jobId) {
        const prev = workflow.result as any;
        jobId = prev?.jobId ?? "";
        if (prev?.ops?.createJob) ops.createJob = prev.ops.createJob;
      }
      if (!jobId) throw new Error("Could not resolve jobId");

      // ── SETTING_BUDGET ────────────────────────────────────────────────
      if (this.shouldRunPhase(workflow.state, "SETTING_BUDGET")) {
        this.store.transition(workflow.id, "SETTING_BUDGET");

        const budgetResult = await this.services.setBudget({
          jobId,
          amount: budgetAtomic.toString(),
          idempotencyKey: `client:${input.requestId}:setBudget`,
        });

        if (!budgetResult.ok) throw new Error(`setBudget failed: ${JSON.stringify(budgetResult)}`);

        ops.setBudget.operationId = budgetResult.operationId ?? "";
        ops.setBudget.txHash = budgetResult.result?.txHash;

        this.store.transition(workflow.id, "BUDGET_SET", { jobId, ops });
      }

      // ── APPROVING_USDC ────────────────────────────────────────────────
      if (this.shouldRunPhase(workflow.state, "APPROVING_USDC")) {
        this.store.transition(workflow.id, "APPROVING_USDC");

        const approveResult = await this.services.approveUsdcForErc8183({
          jobId,
          amount: budgetAtomic.toString(),
          idempotencyKey: `client:${input.requestId}:approveUsdc`,
        });

        if (!approveResult.ok) throw new Error(`approveUsdc failed: ${JSON.stringify(approveResult)}`);

        ops.approveUsdc.operationId = approveResult.operationId ?? "";
        ops.approveUsdc.txHash = approveResult.result?.txHash;

        this.store.transition(workflow.id, "USDC_APPROVED", { jobId, ops });
      }

      // ── FUNDING ───────────────────────────────────────────────────────
      if (this.shouldRunPhase(workflow.state, "FUNDING")) {
        this.store.transition(workflow.id, "FUNDING");

        const fundResult = await this.services.fundJob({
          jobId,
          idempotencyKey: `client:${input.requestId}:fundJob`,
        });

        if (!fundResult.ok) throw new Error(`fundJob failed: ${JSON.stringify(fundResult)}`);

        ops.fundJob.operationId = fundResult.operationId ?? "";
        ops.fundJob.txHash = fundResult.result?.txHash;

        // Verify onchain status
        const job = await this.chainReader.getJob(jobId);
        if (job.status !== 1) { // 1 = Funded
          throw new Error(`Expected Funded status, got ${job.status}`);
        }

        this.store.transition(workflow.id, "FUNDED", { jobId, ops });
        this.store.appendEvent({
          workflowId: workflow.id,
          jobId,
          role: "client",
          eventType: "fundJob.done",
          payload: { jobId, status: "Funded" },
        });
      }

      // ── Return result ─────────────────────────────────────────────────
      const result: ClientCreateAndFundOutput = {
        ok: true,
        requestId: input.requestId,
        workflowId: workflow.id,
        jobId,
        status: "Funded",
        budgetUsdc: input.budgetUsdc,
        budgetAtomic: budgetAtomic.toString(),
        provider: input.provider,
        evaluator: input.evaluator,
        operations: ops,
      };

      // Store final result
      this.store.transition(workflow.id, "FUNDED", result);
      this.store.releaseLease(workflow.id);

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.store.recordFailure(workflow.id, "CLIENT_ORCHESTRATOR_ERROR", errMsg, true);
      this.store.releaseLease(workflow.id);
      throw error;
    }
  }

  /**
   * Get workflow status by requestId or jobId.
   */
  getWorkflowStatus(input: { requestId?: string; jobId?: string }): unknown {
    let workflow = null;
    if (input.requestId) {
      workflow = this.store.getByRequestId("erc8183.client_create_and_fund", input.requestId);
    } else if (input.jobId) {
      workflow = this.store.getByJob("erc8183.client_create_and_fund", "client", input.jobId);
    }
    if (!workflow) return { ok: false, reason: "Workflow not found" };

    return {
      ok: true,
      workflowId: workflow.id,
      state: workflow.state,
      jobId: workflow.jobId,
      requestId: workflow.requestId,
      result: workflow.result,
      errorCode: workflow.errorCode,
      errorMessage: workflow.errorMessage,
      attempts: workflow.attempts,
      events: this.store.listEvents(workflow.id),
    };
  }

  private validateInput(input: ClientCreateAndFundInput): void {
    if (!input.requestId) throw new Error("requestId is required");
    if (!input.task) throw new Error("task is required");
    if (!input.acceptanceCriteria?.length) throw new Error("acceptanceCriteria must have at least 1 item");
    if (!input.budgetUsdc) throw new Error("budgetUsdc is required");
    if (!input.provider) throw new Error("provider address is required");
    if (!input.evaluator || input.evaluator.toLowerCase() === ZERO_ADDRESS) {
      throw new Error("evaluator must be non-zero");
    }
    if (!this.walletAddress) throw new Error("Client wallet address not configured");

    // Validate addresses
    if (!/^0x[a-fA-F0-9]{40}$/.test(input.provider)) throw new Error("Invalid provider address");
    if (!/^0x[a-fA-F0-9]{40}$/.test(input.evaluator)) throw new Error("Invalid evaluator address");
  }

  /**
   * Check if a phase should run based on current workflow state.
   * Returns true if the phase hasn't been completed yet.
   */
  private shouldRunPhase(currentState: string, targetPhase: string): boolean {
    const order = [
      "RECEIVED", "VALIDATING", "CREATING_JOB", "JOB_CREATED",
      "SETTING_BUDGET", "BUDGET_SET", "APPROVING_USDC", "USDC_APPROVED",
      "FUNDING", "FUNDED",
    ];
    const currentIdx = order.indexOf(currentState);
    const targetIdx = order.indexOf(targetPhase);
    // Run if current state is before or at the target phase
    return currentIdx <= targetIdx;
  }
}
