/**
 * Client Workflow — Human-assisted ERC-8183 job creation via Hermes/OpenClaw.
 *
 * Client VPS flow:
 *   Hermes/OpenClaw → local Runner MCP role=client → wallet adapter → ERC-8183
 *
 * Chat transport (Telegram, Discord, etc.) is owned by Hermes/OpenClaw.
 * ArcLayer exposes MCP tools only.
 *
 * The client remains human-assisted. Two confirmation gates:
 *   1. "Confirm job creation?" → createJob only
 *   2. "Provider set budget to X. Confirm approve and fund?" → approve + fund
 *
 * Client NEVER calls setBudget. Provider does that.
 * Client NEVER automatically funds without second confirmation.
 */

import { isJobEnvelope, extractProposedBudget, parseUsdcToAtomic, atomicToUsdc } from "@arclayer/runner-core";
import type { RunnerServices } from "../services";
import type { ArcLayerMcpConnector } from "../mcp-connector";

// ── Types ──────────────────────────────────────────────────────────────────

export type ClientJobDraft = {
  task: string;
  input?: unknown;
  acceptanceCriteria: { id: string; description: string; mandatory: boolean }[];
  providerAddress: string;
  evaluatorAddress: string;
  proposedBudgetUsdc: string;
  deadlineHours: number;
  x402Enabled: boolean;
  x402MaxSpendUsdc?: string;
  x402AllowedHosts?: string[];
};

export type ClientJobState =
  | "drafting"
  | "awaiting_create_confirmation"
  | "creating"
  | "created"
  | "awaiting_fund_confirmation"
  | "approving"
  | "funding"
  | "funded"
  | "failed";

export type ClientJobContext = {
  localJobId?: string;
  erc8183JobId?: string;
  proposedBudgetAtomic?: string;
  providerAddress?: string;
  evaluatorAddress?: string;
  createTxHash?: string;
  setBudgetTxHash?: string;
  approveTxHash?: string;
  fundTxHash?: string;
  state: ClientJobState;
  error?: string;
};

// ── Client Workflow ────────────────────────────────────────────────────────

export class ClientWorkflow {
  private jobs = new Map<string, ClientJobContext>();

  constructor(
    private readonly services: RunnerServices,
    private readonly mcp: ArcLayerMcpConnector,
  ) {}

  /**
   * Step 1: Prepare job draft for client confirmation.
   *
   * Hermes/OpenClaw calls this when the client says "Create a backend job..."
   * Returns a formatted message for confirmation.
   */
  prepareJob(draft: ClientJobDraft): {
    confirmationMessage: string;
    contextId: string;
  } {
    const contextId = `client-job-${Date.now()}`;

    this.jobs.set(contextId, {
      state: "awaiting_create_confirmation",
      proposedBudgetAtomic: parseUsdcToAtomic(draft.proposedBudgetUsdc).toString(),
      providerAddress: draft.providerAddress.toLowerCase(),
      evaluatorAddress: draft.evaluatorAddress.toLowerCase(),
    });

    // Exact decimal formatting — no floating-point arithmetic
    const budget = atomicToUsdc(parseUsdcToAtomic(draft.proposedBudgetUsdc));
    const deadline = `${draft.deadlineHours}h`;

    const criteria = draft.acceptanceCriteria
      .map((c) => `${c.mandatory ? "✅" : "⬜"} ${c.description}`)
      .join("\n");

    const confirmationMessage = [
      `📋 *New ERC-8183 Job Draft*`,
      ``,
      `*Task:* ${draft.task}`,
      `*Provider:* \`${draft.providerAddress.slice(0, 10)}…\``,
      `*Evaluator:* \`${draft.evaluatorAddress.slice(0, 10)}…\``,
      `*Budget:* ${budget} USDC (proposed)`,
      `*Deadline:* ${deadline}`,
      ``,
      `*Acceptance Criteria:*`,
      criteria,
      ``,
      draft.x402Enabled
        ? `*x402:* Enabled (max ${draft.x402MaxSpendUsdc ?? "0.01"} USDC)`
        : `*x402:* Disabled`,
      ``,
      `⚠️ Provider will set the actual budget. You will confirm approve+fund after.`,
      ``,
      `Confirm job creation? Reply *yes* to proceed.`,
    ].join("\n");

    return { confirmationMessage, contextId };
  }

  /**
   * Step 2: Execute createJob after client confirms.
   *
   * Only creates the job on-chain. Does NOT setBudget, approve, or fund.
   */
  async executeCreate(
    contextId: string,
    draft: ClientJobDraft,
  ): Promise<{
    ok: boolean;
    jobId?: string;
    txHash?: string;
    message: string;
  }> {
    const ctx = this.jobs.get(contextId);
    if (!ctx || ctx.state !== "awaiting_create_confirmation") {
      return { ok: false, message: "Invalid context or wrong state." };
    }

    ctx.state = "creating";

    try {
      // Call createJob via RunnerServices
      const result = await this.services.createJob({
        provider: draft.providerAddress,
        evaluator: draft.evaluatorAddress,
        expiredAt: String(Math.floor(Date.now() / 1000) + draft.deadlineHours * 3600),
        description: draft.task,
        hook: "0x0000000000000000000000000000000000000000",
      });

      const resultObj = result as Record<string, unknown>;
      ctx.state = "created";
      ctx.erc8183JobId = String(resultObj.jobId ?? "");
      ctx.createTxHash = String(resultObj.txHash ?? "");

      return {
        ok: true,
        jobId: ctx.erc8183JobId,
        txHash: ctx.createTxHash,
        message: [
          `✅ *Job Created*`,
          ``,
          `Job ID: \`${ctx.erc8183JobId}\``,
          `Tx: \`${ctx.createTxHash?.slice(0, 16)}…\``,
          ``,
          `⏳ Waiting for provider to set budget...`,
          `You will be notified to confirm approve+fund.`,
        ].join("\n"),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.state = "failed";
      ctx.error = msg;
      return { ok: false, message: `❌ Job creation failed: ${msg}` };
    }
  }

  /**
   * Step 3: Notify client that provider set the budget.
   *
   * Called when the provider worker completes setBudget.
   * Returns a formatted message asking for second confirmation.
   */
  notifyBudgetSet(
    contextId: string,
    budgetUsdc: string,
    setBudgetTxHash: string,
  ): string {
    const ctx = this.jobs.get(contextId);
    if (!ctx) return "Unknown job context.";

    ctx.state = "awaiting_fund_confirmation";
    ctx.setBudgetTxHash = setBudgetTxHash;

    // Exact decimal formatting — no floating-point arithmetic
    const budget = atomicToUsdc(parseUsdcToAtomic(budgetUsdc));

    return [
      `💰 *Provider Set Budget*`,
      ``,
      `Job ID: \`${ctx.erc8183JobId}\``,
      `Budget: *${budget} USDC*`,
      `setBudget Tx: \`${setBudgetTxHash.slice(0, 16)}…\``,
      ``,
      `Confirm approve and fund?`,
      `Reply *yes* to proceed with USDC approval + escrow funding.`,
    ].join("\n");
  }

  /**
   * Step 4: Execute approve + fund after second confirmation.
   *
   * Client must verify:
   *   - On-chain budget matches proposal
   *   - Job is not expired
   *   - Status is Open
   *
   * Two transactions: USDC.approve → fund
   */
  async executeFund(
    contextId: string,
  ): Promise<{
    ok: boolean;
    approveTxHash?: string;
    fundTxHash?: string;
    message: string;
  }> {
    const ctx = this.jobs.get(contextId);
    if (!ctx || ctx.state !== "awaiting_fund_confirmation") {
      return { ok: false, message: "Invalid context or wrong state." };
    }

    // All required invariants must be present from prepareJob()
    if (!ctx.erc8183JobId) {
      ctx.state = "failed";
      return { ok: false, message: "❌ Missing erc8183JobId in context." };
    }
    if (!ctx.proposedBudgetAtomic) {
      ctx.state = "failed";
      return { ok: false, message: "❌ Missing proposedBudgetAtomic in context." };
    }
    if (!ctx.providerAddress) {
      ctx.state = "failed";
      return { ok: false, message: "❌ Missing providerAddress in context." };
    }
    if (!ctx.evaluatorAddress) {
      ctx.state = "failed";
      return { ok: false, message: "❌ Missing evaluatorAddress in context." };
    }

    ctx.state = "approving";

    try {
      // Step 0: Read on-chain job to get actual budget and verify preconditions
      const onchainStatus = await this.mcp.callTool("jobs.get_onchain_status", {
        jobId: ctx.erc8183JobId,
      }) as Record<string, unknown>;

      const statusCode = Number(onchainStatus.statusCode ?? -1);
      if (statusCode !== 0) {
        ctx.state = "failed";
        return { ok: false, message: `❌ Job is not Open (status: ${onchainStatus.statusLabel ?? statusCode}). Cannot fund.` };
      }

      const onchainBudget = String(onchainStatus.budgetAtomic ?? "");
      if (!onchainBudget || onchainBudget === "0") {
        ctx.state = "failed";
        return { ok: false, message: "❌ Provider has not set budget yet." };
      }

      // Invariant: proposed budget === onchain budget (strict)
      if (onchainBudget !== ctx.proposedBudgetAtomic) {
        ctx.state = "failed";
        return {
          ok: false,
          message: `❌ Budget mismatch. Proposed ${ctx.proposedBudgetAtomic}, on-chain ${onchainBudget}. Funding blocked.`,
        };
      }

      // Invariant: provider address must match proposal (strict)
      const onchainProvider = String(onchainStatus.provider ?? "").toLowerCase();
      if (!onchainProvider) {
        ctx.state = "failed";
        return { ok: false, message: "❌ Provider not set on-chain. Funding blocked." };
      }
      if (onchainProvider !== ctx.providerAddress) {
        ctx.state = "failed";
        return { ok: false, message: "❌ Provider mismatch. Funding blocked." };
      }

      // Invariant: evaluator address must match proposal (strict)
      const onchainEvaluator = String(onchainStatus.evaluator ?? "").toLowerCase();
      if (!onchainEvaluator) {
        ctx.state = "failed";
        return { ok: false, message: "❌ Evaluator not set on-chain. Funding blocked." };
      }
      if (onchainEvaluator !== ctx.evaluatorAddress) {
        ctx.state = "failed";
        return { ok: false, message: "❌ Evaluator mismatch. Funding blocked." };
      }

      // Step 1: Approve USDC for exact proposed budget (invariant amount)
      const approveResult = await this.services.approveUsdcForErc8183({
        amount: ctx.proposedBudgetAtomic,
        idempotencyKey: `approveUsdc:job-${ctx.erc8183JobId}:${ctx.proposedBudgetAtomic}`,
      });

      const approveObj = approveResult as Record<string, unknown>;
      ctx.approveTxHash = String(approveObj.txHash ?? "");
      ctx.state = "funding";

      // Step 2: Fund job
      const fundResult = await this.services.fundJob({
        jobId: ctx.erc8183JobId,
        optParams: "0x",
      });

      const fundObj = fundResult as Record<string, unknown>;
      ctx.fundTxHash = String(fundObj.txHash ?? "");
      ctx.state = "funded";

      return {
        ok: true,
        approveTxHash: ctx.approveTxHash,
        fundTxHash: ctx.fundTxHash,
        message: [
          `✅ *Job Funded*`,
          ``,
          `Job ID: \`${ctx.erc8183JobId}\``,
          `Approve Tx: \`${ctx.approveTxHash?.slice(0, 16)}…\``,
          `Fund Tx: \`${ctx.fundTxHash?.slice(0, 16)}…\``,
          ``,
          `🚀 Provider will now execute the task.`,
        ].join("\n"),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.state = "failed";
      ctx.error = msg;
      return { ok: false, message: `❌ Funding failed: ${msg}` };
    }
  }

  /**
   * Get current state of a client job context.
   */
  getContext(contextId: string): ClientJobContext | null {
    return this.jobs.get(contextId) ?? null;
  }

  /**
   * Find context by ERC-8183 job ID.
   */
  findByJobId(erc8183JobId: string): { contextId: string; ctx: ClientJobContext } | null {
    for (const [contextId, ctx] of this.jobs) {
      if (ctx.erc8183JobId === erc8183JobId) {
        return { contextId, ctx };
      }
    }
    return null;
  }
}
