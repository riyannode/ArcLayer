/**
 * ApprovalManager — orchestrates ApprovalStore + RunnerServices execution.
 *
 * Handles the approval lifecycle:
 *   create → pending
 *   approve → pending → executing → (execute via services) → executed | failed
 *   reject → pending → rejected
 *   cancel → pending → cancelled
 *
 * Security:
 *   - Role, wallet, chainId validation on approve
 *   - Request hash validation (stored + optional expectedRequestHash)
 *   - Single-use: atomic pending → executing transition
 *   - Duplicate approve returns existing state, never creates duplicate tx
 *   - Expiry: check-on-read and check-on-approve
 *   - Execution uses existing service methods (which use ExecutionGateway.execute())
 *
 * No parallel write path.
 */

import {
  computeRequestHash,
  RunnerError,
  type ApprovalActionType,
  type ApprovalRecord,
} from "@arclayer/runner-core";
import {
  Erc8183CreateJobInputSchema,
  Erc8183ApproveUsdcInputSchema,
  Erc8183FundJobInputSchema,
  Erc8183ClaimRefundInputSchema,
} from "@arclayer/runner-core";
import { ApprovalStore } from "./approval-store";
import type { RunnerServices } from "./services";
import { randomUUID } from "node:crypto";
import path from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export type CreateApprovalArgs = {
  actionType: ApprovalActionType;
  walletAddress: string;
  chainId: number;
  jobId?: string;
  amount?: string;
  params: Record<string, unknown>;
  expiresInSeconds?: number;
  idempotencyKey?: string;
};

export type ApproveArgs = {
  approvalId: string;
  walletAddress: string;
  role: string;
  chainId: number;
  expectedRequestHash?: string;
};

export type RejectArgs = {
  approvalId: string;
  walletAddress: string;
  role: string;
  reason?: string;
};

export type CancelArgs = {
  approvalId: string;
  walletAddress: string;
  role: string;
};

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_SECONDS = 300; // 5 minutes
const MAX_EXPIRY_SECONDS = 86400;   // 24 hours

// ── Manager ────────────────────────────────────────────────────────────────

export class ApprovalManager {
  readonly store: ApprovalStore;

  constructor(
    private readonly services: RunnerServices,
    dataDir: string,
  ) {
    this.store = new ApprovalStore(
      path.join(dataDir, "approvals.db")
    );
  }

  // ── Create ───────────────────────────────────────────────────────────

  createApproval(args: CreateApprovalArgs): {
    ok: true;
    approvalId: string;
    state: string;
    expiresAt: string;
    requestHash: string;
    summary: string;
    renderableMessage: string;
  } {
    const now = new Date();
    const expiresInSeconds = Math.min(
      args.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
      MAX_EXPIRY_SECONDS,
    );
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000).toISOString();

    const requestHash = computeRequestHash(args.params);
    const idempotencyKey = args.idempotencyKey
      ?? `approval:${args.actionType}:${requestHash.slice(0, 16)}:${randomUUID().slice(0, 8)}`;

    // Check for existing approval with same idempotency key
    const existing = this.store.getByIdempotencyKey(idempotencyKey);
    if (existing) {
      return {
        ok: true,
        approvalId: existing.approvalId,
        state: existing.state,
        expiresAt: existing.expiresAt,
        requestHash: existing.requestHash,
        summary: this.buildSummary(existing),
        renderableMessage: this.buildRenderableMessage(existing),
      };
    }

    const approval = this.store.create({
      actionType: args.actionType,
      role: "client",
      walletAddress: args.walletAddress,
      chainId: args.chainId,
      jobId: args.jobId,
      amount: args.amount,
      requestHash,
      idempotencyKey,
      params: args.params,
      expiresAt,
    });

    return {
      ok: true,
      approvalId: approval.approvalId,
      state: approval.state,
      expiresAt: approval.expiresAt,
      requestHash: approval.requestHash,
      summary: this.buildSummary(approval),
      renderableMessage: this.buildRenderableMessage(approval),
    };
  }

  // ── Get ──────────────────────────────────────────────────────────────

  getApproval(approvalId: string, walletAddress: string, role: string): ApprovalRecord {
    const approval = this.store.get(approvalId);
    if (!approval) {
      throw new RunnerError("APPROVAL_NOT_FOUND", `Approval ${approvalId} not found`, 404);
    }

    // Role check
    if (approval.role !== role) {
      throw new RunnerError(
        "ROLE_MISMATCH",
        `Approval requires role '${approval.role}', got '${role}'`,
        403,
      );
    }

    // Wallet check
    if (approval.walletAddress !== walletAddress.toLowerCase()) {
      throw new RunnerError(
        "WALLET_MISMATCH",
        `Approval belongs to ${approval.walletAddress}, not ${walletAddress}`,
        403,
      );
    }

    return approval;
  }

  // ── Approve ──────────────────────────────────────────────────────────

  async approve(args: ApproveArgs): Promise<{
    ok: boolean;
    approvalId: string;
    state: string;
    txHash?: string;
    result?: unknown;
    operationId?: string;
    idempotent?: boolean;
    error?: string;
  }> {
    const approval = this.store.get(args.approvalId);
    if (!approval) {
      throw new RunnerError("APPROVAL_NOT_FOUND", `Approval ${args.approvalId} not found`, 404);
    }

    // ── Security checks ────────────────────────────────────────────────

    // Role check
    if (approval.role !== args.role) {
      throw new RunnerError(
        "ROLE_MISMATCH",
        `Approval requires role '${approval.role}', got '${args.role}'`,
        403,
      );
    }

    // Wallet check
    if (approval.walletAddress !== args.walletAddress.toLowerCase()) {
      throw new RunnerError(
        "WALLET_MISMATCH",
        `Approval belongs to ${approval.walletAddress}, not ${args.walletAddress}`,
        403,
      );
    }

    // expectedRequestHash check (if provided by caller)
    if (args.expectedRequestHash && args.expectedRequestHash !== approval.requestHash) {
      throw new RunnerError(
        "REQUEST_HASH_MISMATCH",
        `Expected requestHash ${args.expectedRequestHash}, stored ${approval.requestHash}`,
        400,
      );
    }

    // Chain ID check
    if (args.chainId !== approval.chainId) {
      throw new RunnerError(
        "CHAIN_MISMATCH",
        `Approval requires chainId ${approval.chainId}, got ${args.chainId}`,
        400,
      );
    }

    // Terminal states: return existing result, no new tx
    if (approval.state === "executed") {
      return {
        ok: true,
        approvalId: approval.approvalId,
        state: "executed",
        txHash: approval.txHash ?? undefined,
        result: approval.resultJson ? JSON.parse(approval.resultJson) : undefined,
        operationId: approval.operationId ?? undefined,
        idempotent: true,
      };
    }

    if (approval.state === "executing") {
      return {
        ok: false,
        approvalId: approval.approvalId,
        state: "executing",
        error: "Approval is currently being executed",
      };
    }

    if (approval.state === "failed") {
      return {
        ok: false,
        approvalId: approval.approvalId,
        state: "failed",
        error: approval.errorMessage ?? "Execution failed",
      };
    }

    if (approval.state === "rejected") {
      throw new RunnerError("APPROVAL_REJECTED", "Approval has been rejected", 400);
    }
    if (approval.state === "cancelled") {
      throw new RunnerError("APPROVAL_CANCELLED", "Approval has been cancelled", 400);
    }
    if (approval.state === "expired") {
      throw new RunnerError("APPROVAL_EXPIRED", "Approval has expired", 400);
    }

    // ── Atomic transition: pending → executing ─────────────────────────
    const transition = this.store.transitionToExecuting(args.approvalId);
    if (!transition.ok) {
      // Re-read to get current state
      const current = this.store.get(args.approvalId);
      return {
        ok: false,
        approvalId: args.approvalId,
        state: current?.state ?? "unknown",
        error: transition.error,
      };
    }

    // ── Execute via existing service methods ───────────────────────────
    // These methods internally use ExecutionGateway.execute() — no parallel write path.
    try {
      const params = JSON.parse(approval.paramsJson) as Record<string, unknown>;
      const validatedParams = this.validateActionParams(approval.actionType, params);
      const result = await this.executeAction(approval.actionType, validatedParams);

      // Check if service returned structured failure instead of throwing
      const resultObj = result as Record<string, unknown>;
      if (resultObj && resultObj.ok === false) {
        const reason = (resultObj.reason ?? resultObj.error ?? "Service returned ok: false") as string;
        this.store.transitionToFailed(args.approvalId, reason);
        return {
          ok: false,
          approvalId: args.approvalId,
          state: "failed",
          error: reason.slice(0, 500),
        };
      }

      // Extract txHash and operationId from result
      const txHash = resultObj?.txHash as string | undefined;
      const operationId = resultObj?.operationId as string | undefined;

      const executed = this.store.transitionToExecuted(
        args.approvalId,
        txHash,
        result,
        operationId,
      );

      return {
        ok: true,
        approvalId: executed.approvalId,
        state: "executed",
        txHash: executed.txHash ?? undefined,
        result: executed.resultJson ? JSON.parse(executed.resultJson) : undefined,
        operationId: executed.operationId ?? undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.transitionToFailed(args.approvalId, message);

      return {
        ok: false,
        approvalId: args.approvalId,
        state: "failed",
        error: message.slice(0, 500),
      };
    }
  }

  // ── Reject ───────────────────────────────────────────────────────────

  reject(args: RejectArgs): { ok: boolean; approvalId: string; state: string; error?: string } {
    const approval = this.store.get(args.approvalId);
    if (!approval) {
      throw new RunnerError("APPROVAL_NOT_FOUND", `Approval ${args.approvalId} not found`, 404);
    }

    // Role check
    if (approval.role !== args.role) {
      throw new RunnerError("ROLE_MISMATCH", `Approval requires role '${approval.role}', got '${args.role}'`, 403);
    }

    // Wallet check
    if (approval.walletAddress !== args.walletAddress.toLowerCase()) {
      throw new RunnerError("WALLET_MISMATCH", "Wallet address does not match approval", 403);
    }

    const result = this.store.transitionToRejected(args.approvalId, args.reason);
    if (!result.ok) {
      return {
        ok: false,
        approvalId: args.approvalId,
        state: result.current?.state ?? "unknown",
        error: result.error,
      };
    }

    return {
      ok: true,
      approvalId: args.approvalId,
      state: "rejected",
    };
  }

  // ── Cancel ───────────────────────────────────────────────────────────

  cancel(args: CancelArgs): { ok: boolean; approvalId: string; state: string; error?: string } {
    const approval = this.store.get(args.approvalId);
    if (!approval) {
      throw new RunnerError("APPROVAL_NOT_FOUND", `Approval ${args.approvalId} not found`, 404);
    }

    // Role check
    if (approval.role !== args.role) {
      throw new RunnerError("ROLE_MISMATCH", `Approval requires role '${approval.role}', got '${args.role}'`, 403);
    }

    // Wallet check
    if (approval.walletAddress !== args.walletAddress.toLowerCase()) {
      throw new RunnerError("WALLET_MISMATCH", "Wallet address does not match approval", 403);
    }

    const result = this.store.transitionToCancelled(args.approvalId);
    if (!result.ok) {
      return {
        ok: false,
        approvalId: args.approvalId,
        state: result.current?.state ?? "unknown",
        error: result.error,
      };
    }

    return {
      ok: true,
      approvalId: args.approvalId,
      state: "cancelled",
    };
  }

  // ── List Pending ─────────────────────────────────────────────────────

  listPending(walletAddress: string, limit?: number): ApprovalRecord[] {
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      throw new RunnerError("INVALID_WALLET", "walletAddress is required and must be a valid EVM address", 400);
    }
    return this.store.listPending(walletAddress, limit);
  }

  // ── Action Execution ─────────────────────────────────────────────────

  /**
   * Execute the underlying action through existing service methods.
   * All service methods use ExecutionGateway.execute() — no parallel write path.
   */
  /**
   * Validate params against the action-specific Zod schema.
   * Prevents storing arbitrary/invalid params that bypass MCP schema validation.
   */
  private validateActionParams(
    actionType: ApprovalActionType,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const schemaMap: Record<string, { parse: (v: unknown) => unknown }> = {
      createJob: Erc8183CreateJobInputSchema,
      approveUsdc: Erc8183ApproveUsdcInputSchema,
      fundJob: Erc8183FundJobInputSchema,
      claimRefund: Erc8183ClaimRefundInputSchema,
    };

    const schema = schemaMap[actionType];
    if (!schema) {
      throw new RunnerError("UNSUPPORTED_ACTION", `No schema for action '${actionType}'`, 400);
    }

    try {
      return schema.parse(params) as Record<string, unknown>;
    } catch (err: unknown) {
      const issues = err instanceof Error ? err.message : String(err);
      throw new RunnerError(
        "INVALID_PARAMS",
        `Approval params failed ${actionType} schema: ${issues}`,
        400,
      );
    }
  }

  private async executeAction(
    actionType: ApprovalActionType,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (actionType) {
      case "createJob":
        return this.services.createJob(params);
      case "approveUsdc":
        return this.services.approveUsdcForErc8183(params);
      case "fundJob":
        return this.services.fundJob(params);
      case "claimRefund":
        return this.services.claimRefund(params);
      default:
        throw new RunnerError(
          "UNSUPPORTED_ACTION",
          `Action type '${actionType}' is not supported`,
          400,
        );
    }
  }

  // ── Renderable messages ──────────────────────────────────────────────

  private buildSummary(approval: ApprovalRecord): string {
    const parts = [
      `Action: ${approval.actionType}`,
      `Wallet: ${approval.walletAddress}`,
      `Chain: ${approval.chainId}`,
    ];
    if (approval.jobId) parts.push(`Job: ${approval.jobId}`);
    if (approval.amount) parts.push(`Amount: ${approval.amount}`);
    parts.push(`Expires: ${approval.expiresAt}`);
    return parts.join(" | ");
  }

  private buildRenderableMessage(approval: ApprovalRecord): string {
    const lines = [
      `🔐 **Approval Required**`,
      ``,
      `**Action:** ${approval.actionType}`,
      `**Wallet:** \`${approval.walletAddress}\``,
      `**Chain ID:** ${approval.chainId}`,
    ];
    if (approval.jobId) lines.push(`**Job ID:** ${approval.jobId}`);
    if (approval.amount) lines.push(`**Amount:** ${approval.amount}`);
    lines.push(
      ``,
      `**Expires:** ${approval.expiresAt}`,
      `**Approval ID:** \`${approval.approvalId}\``,
      ``,
      `Reply *approve* to execute, *reject* to decline, or *cancel* to withdraw.`,
    );
    return lines.join("\n");
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  close(): void {
    this.store.close();
  }
}
