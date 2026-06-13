/**
 * ExecutionGateway — single write-operation boundary for all Circle CLI / contract writes.
 *
 * Phase 4B: in-memory OperationRecord lifecycle + idempotency.
 * No SQLite, no persistent locks (Phase 5).
 *
 * Every write operation routed through this gateway:
 *   1. Creates an OperationRecord
 *   2. Validates idempotencyKey + paramsHash
 *   3. Transitions through operation states
 *   4. Executes the Circle CLI write
 *   5. Classifies result (confirmed / failed / unknown)
 */

import { randomUUID } from "node:crypto";
import {
  assertOperationStateTransition,
  sha256Json,
  RunnerError,
  type OperationRecord,
  type OperationState,
  type OperationErrorCode,
} from "@arclayer/runner-core";
import { CircleCliAdapter, type CircleCliResult } from "@arclayer/circle-cli-adapter";
import type { JsonlReceiptStore } from "@arclayer/runner-core";

// ── Write Operation Types ──────────────────────────────────────────────

export type WriteOperationKind =
  | "createJob"
  | "setBudget"
  | "approveUsdc"
  | "fundJob"
  | "completeJob"
  | "rejectJob"
  | "claimRefund"
  | "setProvider"
  | "submitDeliverable";

export type WriteOperationInput = {
  kind: WriteOperationKind;
  idempotencyKey: string;
  paramsHash: string;
  agentId?: string;
  walletAddress: string;
  chain: string;
  /** Chain ID for operation record (default: 5042002 Arc Testnet). */
  chainId?: number;
  contractAddress: string;
  /** Human-readable description for receipts. */
  description?: string;
};

export type WriteOperationResult = {
  ok: boolean;
  operationId: string;
  state: OperationState;
  txHash?: string;
  circleResult?: CircleCliResult;
  receipt?: unknown;
  errorCode?: OperationErrorCode;
  errorMessage?: string;
  /** True if this was an idempotent replay of an already-completed operation. */
  idempotent?: boolean;
};

// ── Circle CLI Execution Function Type ─────────────────────────────────

export type CircleCliExecuteFn = (
  circle: CircleCliAdapter,
  signal?: AbortSignal
) => Promise<CircleCliResult>;

// ── Result Classification ──────────────────────────────────────────────

/**
 * Classify a Circle CLI result into an operation state.
 *
 * Classification rules:
 *   - explicit success receipt with txHash → confirmed
 *   - txHash only (no explicit success)   → broadcast
 *   - timeout/abort/no clear result       → unknown
 *   - explicit CLI error                  → failed
 *
 * broadcast is NON-terminal — caller can retry to get confirmation.
 * unknown is NON-terminal — tx may have been broadcast; needs reconciliation.
 */
function classifyCircleResult(
  result: CircleCliResult,
  error?: Error
): OperationState {
  // If we got an error, check if it's a timeout/abort (ambiguous)
  if (error) {
    const msg = error.message.toLowerCase();
    // AbortSignal abort
    if (error.name === "AbortError") return "unknown";
    // execFile timeout: child process killed by SIGTERM
    if (
      (error as any).killed === true ||
      (error as any).signal === "SIGTERM"
    ) return "unknown";
    // Message-based detection for timeout/abort
    if (
      msg.includes("timeout") ||
      msg.includes("abort") ||
      msg.includes("timed out") ||
      msg.includes("etimedout")
    ) return "unknown";
    return "failed";
  }

  // If the result has JSON with an error field, it's a CLI-level failure
  const json = result.json as Record<string, unknown> | undefined;
  if (json?.error || json?.errorCode) {
    return "failed";
  }

  // Check Circle's terminal state field (data.state)
  // Circle CLI waits for terminal state: CONFIRMED, FAILED, DENIED, CANCELLED
  const dataState = (json?.data as Record<string, unknown> | undefined)?.state;
  if (typeof dataState === "string") {
    const upper = dataState.toUpperCase();
    if (upper === "FAILED" || upper === "DENIED" || upper === "CANCELLED") {
      return "failed";
    }
  }

  const txHash = extractTxHash(result);

  // Explicit success receipt with txHash → confirmed
  // Circle CLI returns { status: "confirmed" } or data.state: "CONFIRMED" on finality
  if (txHash && (json?.status === "confirmed" || dataState === "CONFIRMED")) {
    return "confirmed";
  }

  // txHash present but no explicit confirmation → broadcast (not terminal)
  if (txHash) {
    return "broadcast";
  }

  // Ambiguous — CLI returned but no tx hash and no explicit error
  return "unknown";
}

/**
 * Extract a transaction hash from Circle CLI result.
 *
 * Only inspects json.stdout / json fields — does NOT scan the full
 * result object (which includes args with bytes32 values that match
 * the 0x{64} pattern and would false-positive as tx hashes).
 */
function extractTxHash(result: CircleCliResult): string | undefined {
  // Prefer the json-parsed stdout (Circle CLI --output json)
  const json = result.json as Record<string, unknown> | undefined;
  if (json) {
    // Direct txHash field
    if (typeof json.txHash === "string") return json.txHash;
    // Nested data.txHash
    const data = json.data as Record<string, unknown> | undefined;
    if (data && typeof data.txHash === "string") return data.txHash;
    // Nested outputs[0] (some CLI versions)
    if (Array.isArray(json.outputs) && typeof json.outputs[0] === "string" && /^0x[a-fA-F0-9]{64}$/.test(json.outputs[0])) {
      return json.outputs[0];
    }
  }
  // Fallback: scan stdout string only (not the full result object)
  const match = result.stdout.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0];
}

// ── ExecutionGateway ───────────────────────────────────────────────────

export class ExecutionGateway {
  /**
   * In-memory operation store: operationId → OperationRecord.
   * Phase 5 will replace with SQLite.
   */
  private operations = new Map<string, OperationRecord>();

  /**
   * Stored CircleCliResult per operation for idempotent replay.
   * Keyed by operationId.
   */
  private resultCache = new Map<string, CircleCliResult>();

  /**
   * Idempotency index: `${idempotencyKey}:${paramsHash}` → operationId.
   * Allows safe resume/replay for exact matches.
   */
  private idempotencyIndex = new Map<string, string>();

  constructor(
    private readonly circle: CircleCliAdapter,
    private readonly receipts: JsonlReceiptStore,
    private readonly config: {
      agentId: string;
      circleWalletAddress?: string;
      chain: string;
    }
  ) {}

  // ── Core Execute ───────────────────────────────────────────────────

  /**
   * Execute a write operation through the gateway.
   *
   * Lifecycle: created → prepared → reserved → executing → broadcast → confirmed/failed/unknown
   *
   * @param input - Operation metadata (kind, idempotencyKey, paramsHash, etc.)
   * @param executeFn - Function that calls the actual Circle CLI method
   * @param signal - Optional AbortSignal for cancellation
   */
  async execute(
    input: WriteOperationInput,
    executeFn: CircleCliExecuteFn,
    signal?: AbortSignal
  ): Promise<WriteOperationResult> {
    // ── Idempotency check ─────────────────────────────────────────────
    const existing = this.checkIdempotency(input.idempotencyKey, input.paramsHash);
    if (existing) {
      if (existing.state === "confirmed") {
        return {
          ok: true,
          operationId: existing.operationId,
          state: existing.state,
          txHash: existing.txHash,
          circleResult: this.resultCache.get(existing.operationId),
          idempotent: true,
        };
      }
      // If existing is in a non-terminal state, it's still in-flight
      if (
        existing.state === "executing" ||
        existing.state === "broadcast" ||
        existing.state === "prepared" ||
        existing.state === "reserved"
      ) {
        throw new RunnerError(
          "OPERATION_IN_PROGRESS",
          `Operation with idempotencyKey ${input.idempotencyKey} is already in state ${existing.state}`,
          409
        );
      }
      // unknown: tx may have been broadcast — cannot safely retry
      if (existing.state === "unknown") {
        throw new RunnerError(
          "RECONCILIATION_REQUIRED" satisfies OperationErrorCode,
          `Operation ${existing.operationId} is in unknown state — tx may have been broadcast. Reconciliation required before retry.`,
          409,
          { operationId: existing.operationId, idempotencyKey: input.idempotencyKey }
        );
      }
      // failed/cancelled: safe to re-execute by removing old entry
      if (
        existing.state === "failed" ||
        existing.state === "cancelled"
      ) {
        this.operations.delete(existing.operationId);
        this.resultCache.delete(existing.operationId);
        this.idempotencyIndex.delete(
          `${input.idempotencyKey}:${input.paramsHash}`
        );
      }
    }

    // ── Create operation record ───────────────────────────────────────
    const operationId = `op-${randomUUID()}`;
    const now = new Date().toISOString();

    const record: OperationRecord = {
      operationId,
      idempotencyKey: input.idempotencyKey,
      toolName: input.kind,
      agentId: input.agentId ?? this.config.agentId,
      walletAddress: input.walletAddress,
      chainId: input.chainId ?? 5042002, // Default: Arc Testnet
      contractAddress: input.contractAddress,
      paramsHash: input.paramsHash,
      state: "created",
      createdAt: now,
      updatedAt: now,
    };

    this.operations.set(operationId, record);
    this.idempotencyIndex.set(
      `${input.idempotencyKey}:${input.paramsHash}`,
      operationId
    );

    // ── Transition: created → prepared ────────────────────────────────
    this.transitionState(operationId, "prepared");

    // ── Validate prerequisites ────────────────────────────────────────
    if (!input.walletAddress) {
      this.failOperation(operationId, "BROADCAST_FAILED", "circleWalletAddress not configured");
      return this.buildResult(operationId);
    }

    // ── Transition: prepared → reserved ───────────────────────────────
    this.transitionState(operationId, "reserved");

    // ── Transition: reserved → executing ──────────────────────────────
    this.transitionState(operationId, "executing");

    let cliResult: CircleCliResult | undefined;
    let cliError: Error | undefined;

    try {
      cliResult = await executeFn(this.circle, signal);
    } catch (error) {
      cliError = error instanceof Error ? error : new Error(String(error));
    }

    // ── Classify result ───────────────────────────────────────────────
    const terminalState = classifyCircleResult(cliResult!, cliError);

    // ── Transition: executing → terminal ──────────────────────────────
    // The state machine allows executing → broadcast, executing → unknown, executing → failed
    if (terminalState === "confirmed") {
      // confirmed goes through broadcast first
      this.transitionState(operationId, "broadcast");
      this.transitionState(operationId, "confirmed");
    } else {
      this.transitionState(operationId, terminalState);
    }

    // ── Cache result for idempotent replay ────────────────────────────
    if (cliResult) {
      this.resultCache.set(operationId, cliResult);
    }

    // ── Update record with result ─────────────────────────────────────
    const record_final = this.operations.get(operationId)!;
    if (cliResult) {
      record_final.txHash = extractTxHash(cliResult);
    }
    if (terminalState === "failed") {
      record_final.errorCode = "BROADCAST_FAILED";
      record_final.errorMessage = cliError?.message ?? "Circle CLI write failed";
    }
    if (terminalState === "unknown") {
      record_final.errorCode = "UNKNOWN_TX_STATE";
      record_final.errorMessage =
        "Circle CLI timeout or ambiguous result — tx may have been broadcast";
    }
    record_final.updatedAt = new Date().toISOString();

    return this.buildResult(operationId, cliResult);
  }

  // ── Idempotency ────────────────────────────────────────────────────

  private checkIdempotency(
    idempotencyKey: string,
    paramsHash: string
  ): OperationRecord | null {
    const compositeKey = `${idempotencyKey}:${paramsHash}`;
    const operationId = this.idempotencyIndex.get(compositeKey);
    if (!operationId) {
      // Check for same idempotencyKey with DIFFERENT paramsHash → conflict
      for (const [key, opId] of this.idempotencyIndex.entries()) {
        if (key.startsWith(`${idempotencyKey}:`) && key !== compositeKey) {
          const existing = this.operations.get(opId);
          if (existing) {
            throw new RunnerError(
              "IDEMPOTENCY_CONFLICT" satisfies OperationErrorCode,
              `Idempotency conflict: key ${idempotencyKey} was previously used with different params`,
              409,
              { existingParamsHash: existing.paramsHash, requestedParamsHash: paramsHash }
            );
          }
        }
      }
      return null;
    }
    return this.operations.get(operationId) ?? null;
  }

  // ── State Management ───────────────────────────────────────────────

  private transitionState(operationId: string, to: OperationState): void {
    const record = this.operations.get(operationId);
    if (!record) {
      throw new RunnerError("OPERATION_NOT_FOUND", `Operation ${operationId} not found`, 404);
    }
    assertOperationStateTransition(record.state, to);
    record.state = to;
    record.updatedAt = new Date().toISOString();
  }

  private failOperation(
    operationId: string,
    code: OperationErrorCode,
    message: string
  ): void {
    const record = this.operations.get(operationId);
    if (!record) return;

    // Transition through intermediate states if needed
    // created → failed is allowed directly
    if (record.state !== "failed") {
      try {
        this.transitionState(operationId, "failed");
      } catch {
        // If direct transition not allowed, try chain
        // e.g., reserved → executing → failed
        try {
          if (record.state === "reserved") {
            this.transitionState(operationId, "executing");
          }
          this.transitionState(operationId, "failed");
        } catch {
          // Force to failed if all else fails
          record.state = "failed";
        }
      }
    }
    record.errorCode = code;
    record.errorMessage = message;
    record.updatedAt = new Date().toISOString();
  }

  private buildResult(
    operationId: string,
    circleResult?: CircleCliResult
  ): WriteOperationResult {
    const record = this.operations.get(operationId)!;
    return {
      ok: record.state === "confirmed",
      operationId,
      state: record.state,
      txHash: record.txHash,
      circleResult,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
    };
  }

  // ── Query ──────────────────────────────────────────────────────────

  /** Get an operation by id. */
  getOperation(operationId: string): OperationRecord | undefined {
    return this.operations.get(operationId);
  }

  /** Get all operations in a given state. */
  getOperationsByState(state: OperationState): OperationRecord[] {
    const results: OperationRecord[] = [];
    for (const record of this.operations.values()) {
      if (record.state === state) results.push(record);
    }
    return results;
  }

  /** Get the total count of tracked operations. */
  get operationCount(): number {
    return this.operations.size;
  }
}
