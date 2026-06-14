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

const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_TESTNET_CHAIN_NAMES = new Set([
  "arc-testnet",
  "arc",
  "arctestnet",
  "5042002",
]);

const TERMINAL_SUCCESS_STATES = new Set([
  "CONFIRMED",
  "COMPLETE",
  "COMPLETED",
  "SUCCESS",
  "SUCCEEDED",
]);

const MAX_RESULT_CACHE_ENTRIES = 1000;
const MAX_CACHED_STDOUT_BYTES = 64 * 1024;

function truncateText(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8") + "\n...[truncated]";
}

function compactCircleResult(result: CircleCliResult): CircleCliResult {
  return {
    ...result,
    stdout: truncateText(result.stdout ?? "", MAX_CACHED_STDOUT_BYTES),
    stderr: truncateText(result.stderr ?? "", MAX_CACHED_STDOUT_BYTES),
  };
}

function resolveChainId(chain: string, chainId?: number): number {
  if (chainId !== undefined) return chainId;
  if (ARC_TESTNET_CHAIN_NAMES.has(chain.toLowerCase())) return ARC_TESTNET_CHAIN_ID;
  throw new RunnerError(
    "UNSUPPORTED_CHAIN" satisfies OperationErrorCode,
    `ExecutionGateway write attempted on unsupported chain: ${chain}`,
    400,
    { chain }
  );
}

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
  // Circle CLI waits for terminal state: CONFIRMED, FAILED, DENIED, CANCELLED, etc.
  const dataState = (json?.data as Record<string, unknown> | undefined)?.state;
  if (typeof dataState === "string") {
    const upper = dataState.toUpperCase();
    if (upper === "FAILED" || upper === "DENIED" || upper === "REVERTED") {
      return "failed";
    }
    if (upper === "CANCELLED" || upper === "CANCELED") {
      return "cancelled";
    }
  }

  const txHash = extractTxHash(result);

  // Explicit success receipt with txHash → confirmed
  // Check both json.status and data.state for terminal success
  if (txHash) {
    const statusUpper = typeof json?.status === "string" ? json.status.toUpperCase() : undefined;
    const dataStateUpper = typeof dataState === "string" ? dataState.toUpperCase() : undefined;
    if (
      (statusUpper && TERMINAL_SUCCESS_STATES.has(statusUpper)) ||
      (dataStateUpper && TERMINAL_SUCCESS_STATES.has(dataStateUpper))
    ) {
      return "confirmed";
    }
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
      chainId: resolveChainId(input.chain, input.chainId),
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
      this.resultCache.set(operationId, compactCircleResult(cliResult));
      // Evict oldest entries if cache exceeds max
      while (this.resultCache.size > MAX_RESULT_CACHE_ENTRIES) {
        const oldestKey = this.resultCache.keys().next().value;
        if (!oldestKey) break;
        this.resultCache.delete(oldestKey);
      }
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

  /** Get the current resultCache size (for testing). */
  get resultCacheSize(): number {
    return this.resultCache.size;
  }

  /**
   * Reconcile a broadcast or unknown operation to a final state.
   * This is the minimal in-memory reconciliation path — Phase 5 will
   * provide persistent reconciliation with SQLite.
   *
   * Only operations in "broadcast" or "unknown" state can be reconciled.
   */
  reconcileBroadcast(
    operationId: string,
    outcome: "confirmed" | "failed" | "unknown",
    details?: { txHash?: string; errorCode?: OperationErrorCode; errorMessage?: string }
  ): OperationRecord {
    const record = this.operations.get(operationId);
    if (!record) {
      throw new RunnerError("OPERATION_NOT_FOUND", `Operation ${operationId} not found`, 404);
    }

    if (record.state !== "broadcast" && record.state !== "unknown") {
      return record;
    }

    if (details?.txHash) record.txHash = details.txHash;

    if (outcome === "confirmed") {
      if (record.state === "unknown") {
        // Phase 5 can provide richer reconciliation transition handling.
        record.state = "confirmed";
      } else {
        this.transitionState(operationId, "confirmed");
      }
    } else if (outcome === "failed") {
      record.state = "failed";
      record.errorCode = details?.errorCode ?? "BROADCAST_FAILED";
      record.errorMessage = details?.errorMessage ?? "Reconciled as failed";
    } else {
      record.state = "unknown";
      record.errorCode = details?.errorCode ?? "UNKNOWN_TX_STATE";
      record.errorMessage = details?.errorMessage ?? "Still unknown after reconciliation";
    }

    record.updatedAt = new Date().toISOString();
    return record;
  }
}

// ── Gateway Result Assertion ──────────────────────────────────────────

/**
 * Assert that a gateway write succeeded. Throws a RunnerError if the
 * result is not in a confirmed state, ensuring MCP tools/call returns
 * isError=true instead of a successful envelope with an error payload.
 *
 * Call this BEFORE writing success receipts. If it throws, no receipt
 * is appended — the MCP error path handles the failure.
 */
export function assertGatewayWriteSucceeded(
  gwResult: WriteOperationResult
): void {
  if (gwResult.ok && gwResult.state === "confirmed") return;

  const metadata = {
    operationId: gwResult.operationId,
    operationState: gwResult.state,
    txHash: gwResult.txHash,
    errorCode: gwResult.errorCode,
  };

  switch (gwResult.state) {
    case "broadcast":
      throw new RunnerError(
        "OPERATION_IN_PROGRESS",
        `Gateway write broadcast but not confirmed — tx may be pending. operationId=${gwResult.operationId}`,
        409,
        metadata
      );
    case "unknown":
      throw new RunnerError(
        "RECONCILIATION_REQUIRED",
        `Gateway write in unknown state — tx may have been broadcast. Reconciliation required. operationId=${gwResult.operationId}`,
        409,
        metadata
      );
    case "failed":
      throw new RunnerError(
        gwResult.errorCode ?? "BROADCAST_FAILED",
        gwResult.errorMessage ?? `Gateway write failed. operationId=${gwResult.operationId}`,
        422,
        metadata
      );
    case "prepared":
    case "reserved":
    case "executing":
      throw new RunnerError(
        "OPERATION_IN_PROGRESS",
        `Gateway write still in progress (state=${gwResult.state}). operationId=${gwResult.operationId}`,
        409,
        metadata
      );
    case "created":
      throw new RunnerError(
        "BROADCAST_FAILED",
        `Gateway write ended in unexpected state: ${gwResult.state}. operationId=${gwResult.operationId}`,
        422,
        metadata
      );
    case "cancelled":
      throw new RunnerError(
        "OPERATION_CANCELLED",
        `Gateway write was cancelled. operationId=${gwResult.operationId}`,
        409,
        metadata
      );
  }
}
