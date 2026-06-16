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
import { CONTRACTS } from "@arclayer/sdk";
import {
  Erc8183CreateJobInputSchema,
  Erc8183ApproveUsdcInputSchema,
  Erc8183FundJobInputSchema,
  Erc8183ClaimRefundInputSchema,
  Erc8004RegisterApprovalCreateInputSchema,
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
  signal?: AbortSignal;
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
    private readonly configuredChainId?: number,
    private readonly configuredSignerWallet?: string,
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
    // ── Fix #3: Configured signer wallet validation ─────────────────────
    if (this.configuredSignerWallet) {
      if (args.walletAddress.toLowerCase() !== this.configuredSignerWallet.toLowerCase()) {
        throw new RunnerError(
          "SIGNER_WALLET_MISMATCH",
          `Approval wallet ${args.walletAddress} does not match configured signer ${this.configuredSignerWallet}`,
          403,
        );
      }
    }

    // ── Fix #5: Idempotency conflict validation ─────────────────────────
    const existing = this.store.getByIdempotencyKey(idempotencyKey);
    if (existing) {
      // Check for idempotency conflict — same key but different metadata
      if (
        existing.actionType !== args.actionType
        || existing.walletAddress !== args.walletAddress.toLowerCase()
        || existing.chainId !== args.chainId
        || existing.requestHash !== requestHash
      ) {
        throw new RunnerError(
          "IDEMPOTENCY_KEY_CONFLICT",
          `Idempotency key ${idempotencyKey} already exists with different metadata`,
          409,
        );
      }
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
    // ── Fix #1: Validate params and derive display fields ──────────────
    const validatedParams = this.validateActionParams(args.actionType, args.params);
    const { derivedJobId, derivedAmount } = this.deriveDisplayFields(
      args.actionType,
      validatedParams,
    );

    // If caller supplied top-level values that conflict, throw
    if (args.jobId !== undefined && derivedJobId !== undefined && args.jobId !== derivedJobId) {
      throw new RunnerError(
        "DISPLAY_PARAMS_MISMATCH",
        `Caller supplied jobId '${args.jobId}' but validated params derive '${derivedJobId}'`,
        400,
      );
    }
    if (args.amount !== undefined && derivedAmount !== undefined && args.amount !== derivedAmount) {
      throw new RunnerError(
        "DISPLAY_PARAMS_MISMATCH",
        `Caller supplied amount '${args.amount}' but validated params derive '${derivedAmount}'`,
        400,
      );
    }

    // Use derived values (validated) over caller-supplied values
    const finalJobId = derivedJobId ?? args.jobId;
    const finalAmount = derivedAmount ?? args.amount;

    const approval = this.store.create({
      actionType: args.actionType,
      role: "client",
      walletAddress: args.walletAddress,
      chainId: args.chainId,
      jobId: finalJobId,
      amount: finalAmount,
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
    // ── Fix #2: Configured chain validation ────────────────────────────
    if (this.configuredChainId !== undefined && approval.chainId !== this.configuredChainId) {
      throw new RunnerError(
        "CHAIN_MISMATCH",
        `Approval chainId ${approval.chainId} does not match configured chain ${this.configuredChainId}`,
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
      const result = await this.executeAction(approval.actionType, validatedParams, args.signal);

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

  // ── ERC-8004 Registration Helpers ──────────────────────────────────

  /** Get approval by ID without wallet/role validation (for chat approval flow). */
  getApprovalById(approvalId: string): ApprovalRecord | undefined {
    return this.store.get(approvalId);
  }

  /** Approve by ID — transitions pending → approved without wallet check (for chat approval). */
  approveById(approvalId: string): { ok: boolean; approvalId: string; state: string; error?: string } {
    const approval = this.store.get(approvalId);
    if (!approval) {
      return { ok: false, approvalId, state: "unknown", error: "APPROVAL_NOT_FOUND" };
    }
    if (approval.actionType !== "erc8004_register_agent") {
      return { ok: false, approvalId, state: approval.state, error: "INVALID_APPROVAL_ACTION_TYPE" };
    }
    if (approval.state !== "pending") {
      return { ok: false, approvalId, state: approval.state, error: `Cannot approve: state is ${approval.state}` };
    }
    const result = this.store.transitionToApproved(approvalId);
    if (!result.ok) {
      return { ok: false, approvalId, state: result.current?.state ?? "unknown", error: result.error };
    }
    return { ok: true, approvalId: result.approval.approvalId, state: result.approval.state };
  }

  /** Reject by ID — transitions pending → rejected without wallet check. */
  rejectById(approvalId: string, reason?: string): { ok: boolean; approvalId: string; state: string; error?: string } {
    const approval = this.store.get(approvalId);
    if (!approval) {
      return { ok: false, approvalId, state: "unknown", error: "APPROVAL_NOT_FOUND" };
    }
    if (approval.actionType !== "erc8004_register_agent") {
      return { ok: false, approvalId, state: approval.state, error: "INVALID_APPROVAL_ACTION_TYPE" };
    }
    if (approval.state !== "pending") {
      return { ok: false, approvalId, state: approval.state, error: `Cannot reject: state is ${approval.state}` };
    }
    const result = this.store.transitionToRejected(approvalId, reason);
    if (!result.ok) {
      return { ok: false, approvalId, state: result.current?.state ?? "unknown", error: result.error };
    }
    return { ok: true, approvalId, state: "rejected" };
  }

  /** Find existing erc8004_register_agent approval with same controller + metadataURI + role.
   *  Includes active states AND failed approvals that already have an on-chain txHash
   *  (to prevent duplicate on-chain registrations). */
  findExistingByErc8004Signature(
    controllerAddress: string,
    metadataURI: string,
    role: string,
  ): ApprovalRecord | undefined {
    const candidates = this.store.listErc8004DuplicateCandidatesByWallet(controllerAddress.toLowerCase());
    return candidates.find((a) => {
      if (a.actionType !== "erc8004_register_agent") return false;
      try {
        const params = JSON.parse(a.paramsJson) as Record<string, unknown>;
        if (params.metadataURI !== metadataURI || params.role !== role) return false;
        // For failed approvals, only block if on-chain tx was submitted
        if (a.state === "failed") {
          const result = a.resultJson ? (JSON.parse(a.resultJson) as Record<string, unknown>) : {};
          return Boolean(a.txHash || result.txHash);
        }
        return true;
      } catch {
        return false;
      }
    });
  }

  /** Make renderable message available for MCP tool handlers. */
  buildRenderableMessage(approval: ApprovalRecord): string {
    // Delegate to private implementation
    if (approval.actionType === "erc8004_register_agent") {
      return this.buildErc8004RegistrationMessage(approval);
    }
    const lines = [
      "🔐 **Approval Required**",
      "",
      `**Action:** ${approval.actionType}`,
      `**Wallet:** \`${approval.walletAddress}\``,
      `**Chain ID:** ${approval.chainId}`,
    ];
    if (approval.jobId) lines.push(`**Job ID:** ${approval.jobId}`);
    if (approval.amount) lines.push(`**Amount:** ${approval.amount}`);
    lines.push(
      "",
      `**Expires:** ${approval.expiresAt}`,
      `**Approval ID:** \`${approval.approvalId}\``,
      "",
      "Reply *approve* to execute, *reject* to decline, or *cancel* to withdraw.",
    );
    return lines.join("\n");
  }

  // ── ERC-8004 Execute ─────────────────────────────────────────────

  /**
   * Execute approved ERC-8004 registration.
   * Requires approval state = approved.
   * Transitions: approved → executing → executed | failed
   * On success: agent is visible from GET /api/erc8004/agents.
   * On tx success but upsert failure: returns failed_persistence.
   */
  async executeErc8004Registration(
    approvalId: string,
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean;
    approvalId: string;
    state: string;
    txHash?: string;
    tokenId?: string;
    agentId?: string;
    agentVisible?: boolean;
    errorCode?: string;
    error?: string;
    idempotent?: boolean;
    retryable?: boolean;
  }> {
    const approval = this.store.get(approvalId);
    if (!approval) {
      return { ok: false, approvalId, state: "unknown", error: "APPROVAL_NOT_FOUND" };
    }

    if (approval.actionType !== "erc8004_register_agent") {
      return { ok: false, approvalId, state: approval.state, error: "INVALID_APPROVAL_ACTION_TYPE" };
    }

    // Idempotency: if already executed, return existing result
    if (approval.state === "executed") {
      const result = approval.resultJson ? JSON.parse(approval.resultJson) as Record<string, unknown> : {};
      return {
        ok: true,
        approvalId,
        state: "executed",
        txHash: approval.txHash ?? result.txHash as string | undefined,
        tokenId: result.tokenId as string | undefined,
        agentId: result.agentId as string | undefined,
        agentVisible: result.agentVisible as boolean | undefined,
        idempotent: true,
      };
    }

    if (approval.state === "executing") {
      // Allow sync-only retry if previous execution left sync_pending_retryable metadata
      const existingResult = approval.resultJson
        ? JSON.parse(approval.resultJson) as Record<string, unknown>
        : null;

      if (existingResult?.sync_pending_retryable && existingResult?.txHash) {
        // Retry path: skip on-chain tx, only re-sync with stored txHash
        const retryParams = JSON.parse(approval.paramsJson) as Record<string, unknown>;
        retryParams.approvalId = approvalId;
        retryParams.skipOnChainTxHash = existingResult.txHash;

        try {
          if (signal?.aborted) {
            this.store.transitionToFailed(approvalId, "Retry aborted by signal");
            return { ok: false, approvalId, state: "failed", error: "Retry aborted" };
          }

          const result = await this.services.registerErc8004WithApproval(retryParams, signal);
          const resultObj = result as Record<string, unknown>;

          if (resultObj && resultObj.ok === false) {
            const reason = (resultObj.reason ?? resultObj.error ?? "Service returned ok: false") as string;
            const errorCode = (resultObj.errorCode as string) ?? "EXECUTION_FAILED";
            const isRetryable = resultObj.retryable === true || errorCode === "sync_pending_retryable";

            if (isRetryable) {
              // Still retryable — persist updated txHash and stay in executing
              this.store.saveExecutingRetryMetadata(approvalId, {
                sync_pending_retryable: true,
                txHash: resultObj.txHash ?? existingResult.txHash,
              });
              return {
                ok: false,
                approvalId,
                state: "executing",
                txHash: resultObj.txHash as string | undefined ?? existingResult.txHash as string,
                errorCode: "sync_pending_retryable",
                retryable: true,
                error: reason.slice(0, 500),
              };
            }

            // Non-retryable failure — preserve txHash for reconciliation
            const failResult: Record<string, unknown> = {
              txHash: resultObj.txHash ?? existingResult.txHash,
              errorCode, reason: resultObj.reason,
              tokenId: resultObj.tokenId, agentId: resultObj.agentId,
              agentVisible: resultObj.agentVisible,
            };
            this.store.transitionToFailedWithResult(approvalId, reason, failResult);
            return { ok: false, approvalId, state: "failed", errorCode, txHash: resultObj.txHash as string | undefined ?? existingResult.txHash as string, agentVisible: resultObj.agentVisible as boolean | undefined, error: reason.slice(0, 500) };
          }

          // Success!
          const txHash = resultObj?.txHash as string | undefined ?? existingResult.txHash as string;
          const tokenId = resultObj?.tokenId as string | undefined;
          const agentId = resultObj?.agentId as string | undefined;
          const agentVisible = resultObj?.agentVisible as boolean | undefined;

          if (agentVisible === false) {
            // Still not visible — check if retryable
            const errCode = resultObj?.errorCode as string | undefined;
            const retryable = resultObj?.retryable === true || errCode === "sync_pending_retryable";
            if (retryable) {
              this.store.saveExecutingRetryMetadata(approvalId, {
                sync_pending_retryable: true,
                txHash,
              });
              return {
                ok: false, approvalId, state: "executing", txHash,
                errorCode: "sync_pending_retryable", retryable: true,
                error: "Sync still pending. Retry after receipt mines.",
              };
            }
            this.store.transitionToFailedWithResult(approvalId, "Retry sync failed: agent not dashboard-visible.", {
              txHash, errorCode: "failed_persistence",
              tokenId: resultObj?.tokenId, agentId: resultObj?.agentId,
            });
            return {
              ok: false, approvalId, state: "failed", txHash,
              errorCode: "failed_persistence",
              error: "Retry sync succeeded on-chain but agent is not visible from GET /api/erc8004/agents.",
            };
          }

          // Full success on retry
          const executed = this.store.transitionToExecuted(approvalId, txHash, result);
          return {
            ok: true,
            approvalId: executed.approvalId,
            state: "executed",
            txHash: executed.txHash ?? txHash,
            tokenId,
            agentId,
            agentVisible: true,
          };
        } catch (retryError: unknown) {
          const message = retryError instanceof Error ? retryError.message : String(retryError);
          this.store.transitionToFailed(approvalId, message);
          return { ok: false, approvalId, state: "failed", error: message.slice(0, 500) };
        }
      }

      // Not a retryable — block concurrent execution
      return { ok: false, approvalId, state: "executing", error: "Approval is currently being executed" };
    }

    if (approval.state !== "approved") {
      return { ok: false, approvalId, state: approval.state, error: `Cannot execute: state is ${approval.state} (requires approved)` };
    }

    // Atomic: approved → executing
    const transitionResult = this.store.transitionFromApprovedToExecuting(approvalId);

    if (!transitionResult.ok) {
      return { ok: false, approvalId, state: transitionResult.current?.state ?? "unknown", error: transitionResult.error };
    }

    // Execute
    try {
      if (signal?.aborted) {
        this.store.transitionToFailed(approvalId, "Execution aborted by signal");
        return { ok: false, approvalId, state: "failed", error: "Execution aborted" };
      }

      const params = JSON.parse(approval.paramsJson) as Record<string, unknown>;
      params.approvalId = approvalId;
      const result = await this.services.registerErc8004WithApproval(params, signal);

      // Check if service returned structured failure
      const resultObj = result as Record<string, unknown>;
      if (resultObj && resultObj.ok === false) {
        const reason = (resultObj.reason ?? resultObj.error ?? "Service returned ok: false") as string;
        const errorCode = (resultObj.errorCode as string) ?? "EXECUTION_FAILED";

        // Retryable: tx submitted but sync pending — do NOT transition to failed
        const isRetryable = resultObj.retryable === true || errorCode === "sync_pending_retryable";
        if (isRetryable) {
          const txHash = resultObj.txHash as string | undefined;
          this.store.saveExecutingRetryMetadata(approvalId, {
            sync_pending_retryable: true,
            txHash,
          });
          return {
            ok: false,
            approvalId,
            state: "executing",
            txHash,
            agentVisible: false,
            errorCode: "sync_pending_retryable",
            retryable: true,
            error: reason.slice(0, 500),
          };
        }

        this.store.transitionToFailedWithResult(approvalId, reason, {
          txHash: resultObj.txHash as string | undefined,
          errorCode,
          tokenId: resultObj.tokenId as string | undefined,
          agentId: resultObj.agentId as string | undefined,
          agentVisible: resultObj.agentVisible as boolean | undefined,
        });
        return { ok: false, approvalId, state: "failed", errorCode, txHash: resultObj.txHash as string | undefined, agentVisible: resultObj.agentVisible as boolean | undefined, error: reason.slice(0, 500) };
      }

      // Extract results
      const txHash = resultObj?.txHash as string | undefined;
      const tokenId = resultObj?.tokenId as string | undefined;
      const agentId = resultObj?.agentId as string | undefined;
      const agentVisible = resultObj?.agentVisible as boolean | undefined;
      const errorCode = resultObj?.errorCode as string | undefined;

      // Success means: tx ✓ + upsert ✓ + visible in GET /api/erc8004/agents ✓
      // If agentVisible is false, it's a partial failure
      if (agentVisible === false) {
        const isRetryable = resultObj?.retryable === true || errorCode === "sync_pending_retryable";

        if (isRetryable) {
          // Tx submitted but not mined yet — keep in executing so it can be retried
          // Persist txHash in resultJson so a later retry can skip on-chain tx
          this.store.saveExecutingRetryMetadata(approvalId, {
            sync_pending_retryable: true,
            txHash,
          });
          return {
            ok: false,
            approvalId,
            state: "executing",
            txHash,
            tokenId,
            agentId,
            agentVisible: false,
            errorCode: "sync_pending_retryable",
            retryable: true,
            error: (resultObj?.reason as string) ?? "Tx submitted but dashboard sync pending. Retry after receipt mines.",
          };
        }

        // Non-retryable: real persistence failure — preserve txHash for reconciliation
        const failResult: Record<string, unknown> = {
          txHash, errorCode, reason: resultObj?.reason,
          tokenId, agentId,
        };
        this.store.transitionToFailedWithResult(approvalId,
          "On-chain registration succeeded but erc8004_agents upsert failed. Agent is not dashboard-visible.",
          failResult,
        );
        return {
          ok: false,
          approvalId,
          state: "failed",
          txHash,
          tokenId,
          agentId,
          agentVisible: false,
          errorCode: "failed_persistence",
          error: "On-chain tx succeeded but agent is not visible from GET /api/erc8004/agents. Upsert to erc8004_agents failed.",
        };
      }

      // Full success
      const executed = this.store.transitionToExecuted(approvalId, txHash, result);
      return {
        ok: true,
        approvalId: executed.approvalId,
        state: "executed",
        txHash: executed.txHash ?? txHash,
        tokenId,
        agentId,
        agentVisible: true,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.transitionToFailed(approvalId, message);
      return { ok: false, approvalId, state: "failed", error: message.slice(0, 500) };
    }
  }

  /**
   * Convenience: approve + execute in one call.
   * Internal state transitions are still explicit: pending → approved → executing → executed.
   */
  async approveAndExecuteErc8004(
    approvalId: string,
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean;
    approvalId: string;
    state: string;
    txHash?: string;
    tokenId?: string;
    agentId?: string;
    agentVisible?: boolean;
    errorCode?: string;
    error?: string;
    idempotent?: boolean;
    retryable?: boolean;
  }> {
    const approval = this.store.get(approvalId);
    if (!approval) {
      return { ok: false, approvalId, state: "unknown", error: "APPROVAL_NOT_FOUND" };
    }

    if (approval.actionType !== "erc8004_register_agent") {
      return { ok: false, approvalId, state: approval.state, error: "INVALID_APPROVAL_ACTION_TYPE" };
    }

    // If already executed, return idempotent result
    if (approval.state === "executed") {
      return this.executeErc8004Registration(approvalId, signal);
    }

    // If pending, approve first
    if (approval.state === "pending") {
      const approveResult = this.approveById(approvalId);
      if (!approveResult.ok) {
        return { ok: false, approvalId, state: approveResult.state, error: approveResult.error };
      }
    }

    // Now execute
    return this.executeErc8004Registration(approvalId, signal);
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
      erc8004_register_agent: Erc8004RegisterApprovalCreateInputSchema,
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

  /**
   * Derive display fields (jobId, amount) from validated action params.
   * This prevents a caller from showing one amount/jobId while executing different params.
   */
  private deriveDisplayFields(
    actionType: ApprovalActionType,
    validatedParams: Record<string, unknown>,
  ): { derivedJobId?: string; derivedAmount?: string } {
    switch (actionType) {
      case "createJob":
        return {}; // No jobId or amount needed
      case "approveUsdc":
        return { derivedAmount: validatedParams.amount as string | undefined };
      case "fundJob":
      case "claimRefund":
        return { derivedJobId: validatedParams.jobId as string | undefined };
      case "erc8004_register_agent":
        return {}; // role and agentName stored in params, not display fields
      default:
        return {};
    }
  }

  private async executeAction(
    actionType: ApprovalActionType,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    // ── Fix #4: AbortSignal check before execution ─────────────────────
    if (signal?.aborted) {
      throw new Error("Execution aborted by signal");
    }
    switch (actionType) {
      case "createJob":
        return this.services.createJob(params);
      case "approveUsdc":
        return this.services.approveUsdcForErc8183(params);
      case "fundJob":
        return this.services.fundJob(params);
      case "claimRefund":
        return this.services.claimRefund(params);
      case "erc8004_register_agent":
        throw new RunnerError(
          "UNSUPPORTED_ACTION",
          "erc8004_register_agent must use dedicated approve+execute tools (erc8004.register_approval_approve_and_execute), not the generic approval path.",
          400,
        );
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
    if (approval.actionType === "erc8004_register_agent") {
      const params = JSON.parse(approval.paramsJson);
      if (params.role) parts.push(`Role: ${params.role}`);
      if (params.agentName) parts.push(`Agent: ${params.agentName}`);
    }
    if (approval.jobId) parts.push(`Job: ${approval.jobId}`);
    if (approval.amount) parts.push(`Amount: ${approval.amount}`);
    parts.push(`Expires: ${approval.expiresAt}`);
    return parts.join(" | ");
  }

  private buildErc8004RegistrationMessage(approval: ApprovalRecord): string {
    const params = JSON.parse(approval.paramsJson) as Record<string, unknown>;
    const role = (params.role as string) ?? "unknown";
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    const agentName = (params.agentName as string) ?? "unnamed";
    const controller = (params.controllerAddress as string) ?? "—";
    const owner = (params.ownerAddress as string) ?? "—";
    const metadataURI = (params.metadataURI as string) ?? "—";
    const chainId = approval.chainId;
    const registryAddress = (params.registryAddress as string) ?? CONTRACTS.ERC8004_IDENTITY_REGISTRY;

    const lines = [
      `📝 **Register ERC-8004 Agent**`,
      ``,
      `**Role:** ${roleLabel}`,
      `**Controller:** \`${controller}\``,
      `**Owner:** \`${owner}\``,
      `**Agent name:** ${agentName}`,
      `**Metadata URI:** ${metadataURI}`,
      `**Network:** Arc Testnet (${chainId})`,
      `**Registry:** \`${registryAddress}\``,
      ``,
      `**Approval ID:** \`${approval.approvalId}\``,
      `**Expires:** ${approval.expiresAt}`,
      ``,
      `Approve registration?`,
      `Reply *approve* to register, *reject* to decline, or *cancel* to withdraw.`,
    ];
    return lines.join("\n");
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  close(): void {
    this.store.close();
  }
}
