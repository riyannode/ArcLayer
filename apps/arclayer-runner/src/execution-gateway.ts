/**
 * ExecutionGateway — single write-operation boundary for all Circle CLI / contract writes.
 *
 * Phase 5: SQLite-backed operation journal, persistent idempotency, wallet/job locks,
 * and startup reconciliation hooks.
 *
 * Every write operation routed through this gateway:
 *   1. Creates an OperationRecord (persisted to SQLite)
 *   2. Validates idempotencyKey + paramsHash (SQLite-backed)
 *   3. Acquires wallet/job locks (persistent)
 *   4. Transitions through operation states
 *   5. Executes the Circle CLI write
 *   6. Classify result → confirmed | broadcast | unknown | failed | cancelled
 *   7. Persists result + receipt metadata
 *   8. Releases locks on terminal states
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
import { OperationJournal } from "./operation-journal";

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
  /** ERC-8183 job ID for job-level locking. */
  jobId?: string;
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
   * In-memory operation cache: operationId → OperationRecord.
   * Backed by SQLite journal for restart safety.
   */
  private operations = new Map<string, OperationRecord>();

  /**
   * Stored CircleCliResult per operation for idempotent replay.
   * Keyed by operationId. Backed by SQLite journal.
   */
  private resultCache = new Map<string, CircleCliResult>();

  /**
   * Idempotency index: `${idempotencyKey}:${paramsHash}` → operationId.
   * Backed by SQLite journal for restart safety.
   */
  private idempotencyIndex = new Map<string, string>();

  /**
   * SQLite operation journal for persistent state.
   * Phase 5: restart-safe persistence.
   */
  readonly journal: OperationJournal;

  constructor(
    private readonly circle: CircleCliAdapter,
    private readonly receipts: JsonlReceiptStore,
    private readonly config: {
      agentId: string;
      circleWalletAddress?: string;
      chain: string;
      dataDir?: string;
    },
    journal?: OperationJournal
  ) {
    // Use provided journal or create one from dataDir
    if (journal) {
      this.journal = journal;
    } else {
      const path = require("node:path");
      const dataDir = config.dataDir ?? path.join(
        require("node:os").homedir(),
        ".arclayer", "runner"
      );
      this.journal = new OperationJournal(path.join(dataDir, "operations.db"));
    }

    // Reload existing operations from journal on startup
    this.reloadFromJournal();
  }

  /**
   * Reload operations and idempotency index from SQLite on startup.
   * Preserves confirmed replay behavior and unknown/broadcast protection.
   */
  private reloadFromJournal(): void {
    const ops = this.journal.getOperationsByState("confirmed");
    const broadcasts = this.journal.getOperationsByState("broadcast");
    const unknowns = this.journal.getOperationsByState("unknown");
    const executings = this.journal.getOperationsByState("executing");
    const faileds = this.journal.getOperationsByState("failed");
    const cancelleds = this.journal.getOperationsByState("cancelled");

    const allOps = [...ops, ...broadcasts, ...unknowns, ...executings, ...faileds, ...cancelleds];

    for (const row of allOps) {
      const record: OperationRecord = {
        operationId: row.operation_id,
        idempotencyKey: row.idempotency_key,
        toolName: row.kind,
        agentId: row.agent_id ?? undefined,
        walletAddress: row.wallet_address ?? undefined,
        chainId: row.chain_id ?? undefined,
        contractAddress: row.contract_address ?? undefined,
        paramsHash: row.params_hash,
        state: row.state as OperationState,
        txHash: row.tx_hash ?? undefined,
        errorCode: (row.error_code ?? undefined) as OperationErrorCode | undefined,
        errorMessage: row.error_message ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };

      this.operations.set(record.operationId, record);
      this.idempotencyIndex.set(
        `${record.idempotencyKey}:${record.paramsHash}`,
        record.operationId
      );

      // Reload cached results for confirmed operations (idempotent replay)
      if (record.state === "confirmed") {
        const resultRow = this.journal.getResult(record.operationId);
        if (resultRow?.json_data) {
          try {
            const json = JSON.parse(resultRow.json_data);
            this.resultCache.set(record.operationId, {
              command: "circle",
              args: [],
              stdout: resultRow.stdout ?? "",
              stderr: resultRow.stderr ?? "",
              json,
            });
          } catch {
            // Malformed JSON — skip cache
          }
        }
      }
    }
  }

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
    // ── Idempotency check (journal-backed) ──────────────────────────────
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
        // Delete from journal (cascading)
        this.journal.deleteOperation(existing.operationId);
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

    // Persist to journal FIRST (locks have FK to operations)
    this.journal.insertOperation(record);

    // ── Acquire persistent locks ─────────────────────────────────────
    // Wallet lock
    if (input.walletAddress) {
      const walletLocked = this.journal.acquireWalletLock(input.walletAddress, operationId);
      if (!walletLocked) {
        const holdingOp = this.journal.getWalletLockOperation(input.walletAddress);
        throw new RunnerError(
          "LOCK_CONFLICT" satisfies OperationErrorCode,
          `Wallet ${input.walletAddress} is locked by operation ${holdingOp}`,
          409,
          { walletAddress: input.walletAddress, lockedBy: holdingOp }
        );
      }
    }

    // Job lock (if jobId provided)
    if (input.jobId) {
      const jobLocked = this.journal.acquireJobLock(input.jobId, operationId);
      if (!jobLocked) {
        // Release wallet lock before throwing
        if (input.walletAddress) this.journal.releaseWalletLock(input.walletAddress);
        const holdingOp = this.journal.getJobLockOperation(input.jobId);
        throw new RunnerError(
          "LOCK_CONFLICT" satisfies OperationErrorCode,
          `Job ${input.jobId} is locked by operation ${holdingOp}`,
          409,
          { jobId: input.jobId, lockedBy: holdingOp }
        );
      }
    }

    // Update in-memory caches
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

    // ── Transition: prepared → reserved ──────────────────────────────
    this.transitionState(operationId, "reserved");

    // ── Transition: reserved → executing ─────────────────────────────
    this.transitionState(operationId, "executing");

    let cliResult: CircleCliResult | undefined;
    let cliError: Error | undefined;

    try {
      cliResult = await executeFn(this.circle, signal);
    } catch (error) {
      cliError = error instanceof Error ? error : new Error(String(error));
    }

    // ── Classify result ─────────────────────────────────────────────
    const terminalState = classifyCircleResult(cliResult!, cliError);

    // ── Transition: executing → terminal ─────────────────────────────
    // The state machine allows executing → broadcast, executing → unknown, executing → failed
    if (terminalState === "confirmed") {
      // confirmed goes through broadcast first
      this.transitionState(operationId, "broadcast");
      this.transitionState(operationId, "confirmed");
    } else {
      this.transitionState(operationId, terminalState);
    }

    // ── Persist result and update record ─────────────────────────────
    const record_final = this.operations.get(operationId)!;
    const txHash = cliResult ? extractTxHash(cliResult) : undefined;

    if (txHash) {
      record_final.txHash = txHash;
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

    // Persist final state to journal
    this.journal.updateOperation(operationId, {
      state: terminalState,
      txHash: txHash ?? undefined,
      errorCode: record_final.errorCode,
      errorMessage: record_final.errorMessage,
    });

    // Store compact result in journal for idempotent replay
    if (cliResult) {
      const compact = compactCircleResult(cliResult);
      this.journal.storeResult(operationId, {
        stdout: compact.stdout,
        stderr: compact.stderr,
        json: compact.json,
      });

      // Update in-memory cache
      this.resultCache.set(operationId, compact);
      // Evict oldest entries if cache exceeds max
      while (this.resultCache.size > MAX_RESULT_CACHE_ENTRIES) {
        const oldestKey = this.resultCache.keys().next().value;
        if (!oldestKey) break;
        this.resultCache.delete(oldestKey);
      }
    }

    // ── Release locks on terminal states ─────────────────────────────
    if (
      terminalState === "confirmed" ||
      terminalState === "failed" ||
      terminalState === "cancelled"
    ) {
      this.journal.releaseLocksForOperation(operationId);
    }

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
      // Use journal for authoritative check (survives restart)
      const conflict = this.journal.findIdempotencyConflict(idempotencyKey, paramsHash);
      if (conflict) {
        throw new RunnerError(
          "IDEMPOTENCY_CONFLICT" satisfies OperationErrorCode,
          `Idempotency conflict: key ${idempotencyKey} was previously used with different params`,
          409,
          { existingParamsHash: conflict.params_hash, requestedParamsHash: paramsHash }
        );
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

    // Persist state transition to journal
    this.journal.updateOperation(operationId, { state: to });
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

    // Persist to journal
    this.journal.updateOperation(operationId, {
      state: "failed",
      errorCode: code,
      errorMessage: message,
    });

    // Release locks on failure
    this.journal.releaseLocksForOperation(operationId);
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
   * Phase 5: persistent reconciliation via SQLite journal.
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
        record.state = "confirmed";
      } else {
        assertOperationStateTransition(record.state, "confirmed");
        record.state = "confirmed";
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

    // Persist reconciliation to journal
    this.journal.reconcileOperation(operationId, outcome, details);

    return record;
  }

  /**
   * Get all operations that need reconciliation on startup.
   * Returns broadcast and unknown operations from the journal.
   */
  getReconcilableOperations() {
    return this.journal.getReconcilableOperations();
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  /**
   * Close the gateway and its journal.
   */
  close(): void {
    this.journal.close();
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
