/**
 * ExecutionGateway — single write-operation boundary for all wallet adapter writes.
 *
 * Phase 5: SQLite-backed operation journal, persistent idempotency, wallet/job locks,
 * and startup reconciliation hooks.
 *
 * Every write operation routed through this gateway:
 *   1. Atomically creates OperationRecord + idempotency + locks (one transaction)
 *   2. Transitions through operation states
 *   3. Executes the wallet adapter write
 *   4. Classifies result → confirmed | broadcast | unknown | failed | cancelled
 *   5. Atomically finalizes: state + txHash + result + receipt + lock release (one transaction)
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
import type { WalletExecutionAdapter, WalletExecuteResult } from "@arclayer/runner-core";
import type { JsonlReceiptStore } from "@arclayer/runner-core";
import path from "node:path";
import { OperationJournal } from "./operation-journal";
import type { ReconcilableOperation } from "./operation-journal";

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
  /** Policy metadata for spend enforcement. */
  policy?: {
    action: string;
    method: string;
    amountUsdc?: string;
  };
};

export type WriteOperationResult = {
  ok: boolean;
  operationId: string;
  state: OperationState;
  txHash?: string;
  circleResult?: WalletExecuteResult;
  receipt?: unknown;
  errorCode?: OperationErrorCode;
  errorMessage?: string;
  /** True if this was an idempotent replay of an already-completed operation. */
  idempotent?: boolean;
};

// ── Wallet Execution Function Type ─────────────────────────────────

export type WalletExecuteFn = (
  wallet: WalletExecutionAdapter,
  signal?: AbortSignal,
  idempotencyKey?: string,
) => Promise<WalletExecuteResult>;

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
  "SENT",
]);

const MAX_RESULT_CACHE_ENTRIES = 1000;
const MAX_CACHED_STDOUT_BYTES = 64 * 1024;

function truncateText(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8") + "\n...[truncated]";
}

function compactCircleResult(result: WalletExecuteResult): WalletExecuteResult {
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

function classifyCircleResult(
  result: WalletExecuteResult,
  error?: Error
): OperationState {
  if (error) {
    const msg = error.message.toLowerCase();
    if (error.name === "AbortError") return "unknown";
    if (
      (error as any).killed === true ||
      (error as any).signal === "SIGTERM"
    ) return "unknown";
    if (
      msg.includes("timeout") ||
      msg.includes("abort") ||
      msg.includes("timed out") ||
      msg.includes("etimedout")
    ) return "unknown";
    return "failed";
  }

  const json = result.json as Record<string, unknown> | undefined;
  if (json?.error || json?.errorCode) {
    return "failed";
  }

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

  if (txHash) {
    return "broadcast";
  }

  return "unknown";
}

function extractTxHash(result: WalletExecuteResult): string | undefined {
  const json = result.json as Record<string, unknown> | undefined;
  if (json) {
    if (typeof json.txHash === "string") return json.txHash;
    const data = json.data as Record<string, unknown> | undefined;
    if (data && typeof data.txHash === "string") return data.txHash;
    if (Array.isArray(json.outputs) && typeof json.outputs[0] === "string" && /^0x[a-fA-F0-9]{64}$/.test(json.outputs[0])) {
      return json.outputs[0];
    }
  }
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
   * Stored WalletExecuteResult per operation for idempotent replay.
   * Bounded to MAX_RESULT_CACHE_ENTRIES.
   */
  private resultCache = new Map<string, WalletExecuteResult>();

  /**
   * Idempotency index: `${idempotencyKey}:${paramsHash}` → operationId.
   */
  private idempotencyIndex = new Map<string, string>();

  /**
   * SQLite operation journal for persistent state.
   */
  readonly journal: OperationJournal;

  constructor(
    private readonly wallet: WalletExecutionAdapter,
    private readonly receipts: JsonlReceiptStore,
    private readonly config: {
      agentId: string;
      circleWalletAddress?: string;
      chain: string;
      dataDir?: string;
    },
    journal?: OperationJournal,
    private readonly policyGuard?: {
      assertAllowed(input: {
        walletAddress: string; agentId: string;
        action: string; contract: string; method: string; amountUsdc?: string;
      }): void;
      reserveSpend(input: {
        walletAddress: string; agentId: string; action: string;
        amountUsdc: string; operationId: string; idempotencyKey: string;
      }): void;
    }
  ) {
    if (journal) {
      this.journal = journal;
    } else {
      const dataDir = config.dataDir;
      if (!dataDir) {
        throw new RunnerError(
          "CONFIG_ERROR",
          "ExecutionGateway requires either an explicit OperationJournal or config.dataDir",
          500
        );
      }
      this.journal = new OperationJournal(path.join(dataDir, "operations.db"));
    }

    // Recover non-terminal operations from before restart
    this.journal.recoverNonTerminalOperations();

    // Reload confirmed operations into cache (bounded)
    this.reloadFromJournal();
  }

  /**
   * Reload confirmed operations from SQLite on startup.
   * Bounded to MAX_RESULT_CACHE_ENTRIES — newest first.
   */
  private reloadFromJournal(): void {
    const confirmed = this.journal.loadConfirmedResults(MAX_RESULT_CACHE_ENTRIES);

    for (const entry of confirmed) {
      const record: OperationRecord = {
        operationId: entry.operationId,
        idempotencyKey: entry.idempotencyKey,
        toolName: "",
        paramsHash: entry.paramsHash,
        state: "confirmed",
        txHash: entry.txHash ?? undefined,
        createdAt: "",
        updatedAt: "",
      };

      this.operations.set(record.operationId, record);
      this.idempotencyIndex.set(
        `${record.idempotencyKey}:${record.paramsHash}`,
        record.operationId
      );

      if (entry.result?.json_data) {
        try {
          const json = JSON.parse(entry.result.json_data);
          this.resultCache.set(record.operationId, {
            command: "circle",
            args: [],
            stdout: entry.result.stdout ?? "",
            stderr: entry.result.stderr ?? "",
            json,
          });
        } catch {
          // Malformed JSON — skip cache
        }
      }
    }

    // Also load broadcast/unknown operations for protection
    const reconcilable = this.journal.getReconcilableOperations();
    for (const rec of reconcilable) {
      const row = this.journal.getOperation(rec.operationId);
      if (!row) continue;
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
    }
  }

  // ── Core Execute ───────────────────────────────────────────────────

  async execute(
    input: WriteOperationInput,
    executeFn: WalletExecuteFn,
    signal?: AbortSignal
  ): Promise<WriteOperationResult> {
    // ── Check in-memory idempotency first ────────────────────────────────
    const compositeKey = `${input.idempotencyKey}:${input.paramsHash}`;
    const existingId = this.idempotencyIndex.get(compositeKey);
    if (existingId) {
      const existing = this.operations.get(existingId);
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
        if (existing.state === "unknown") {
          throw new RunnerError(
            "RECONCILIATION_REQUIRED" satisfies OperationErrorCode,
            `Operation ${existing.operationId} is in unknown state — tx may have been broadcast. Reconciliation required before retry.`,
            409,
            { operationId: existing.operationId, idempotencyKey: input.idempotencyKey }
          );
        }
        // failed/cancelled: safe to re-execute
        if (existing.state === "failed" || existing.state === "cancelled") {
          this.operations.delete(existing.operationId);
          this.resultCache.delete(existing.operationId);
          this.idempotencyIndex.delete(compositeKey);
          this.journal.deleteOperation(existing.operationId);
        }
      }
    }

    // ── Create operation atomically with locks ───────────────────────────
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

    const createResult = this.journal.createOperationWithLocks(record, {
      walletAddress: input.walletAddress,
      jobId: input.jobId,
    });

    if (!createResult.ok) {
      switch (createResult.error) {
        case "IDEMPOTENCY_KEY_EXISTS": {
          const details = createResult.details as JournalOperationRow | undefined;
          if (details?.state === "confirmed") {
            return {
              ok: true,
              operationId: details.operation_id,
              state: "confirmed",
              txHash: details.tx_hash ?? undefined,
              circleResult: this.resultCache.get(details.operation_id),
              idempotent: true,
            };
          }
          if (details && ["executing", "broadcast", "prepared", "reserved"].includes(details.state)) {
            throw new RunnerError("OPERATION_IN_PROGRESS", `Operation already in state ${details.state}`, 409);
          }
          if (details?.state === "unknown") {
            throw new RunnerError("RECONCILIATION_REQUIRED", `Operation in unknown state`, 409);
          }
          // failed/cancelled: delete and retry below
          if (details && (details.state === "failed" || details.state === "cancelled")) {
            this.journal.deleteOperation(details.operation_id);
            this.operations.delete(details.operation_id);
            this.resultCache.delete(details.operation_id);
            this.idempotencyIndex.delete(`${input.idempotencyKey}:${input.paramsHash}`);
            // Retry creation
            const retryResult = this.journal.createOperationWithLocks(record, {
              walletAddress: input.walletAddress,
              jobId: input.jobId,
            });
            if (!retryResult.ok) {
              throw new RunnerError("LOCK_CONFLICT", `Retry failed: ${retryResult.error}`, 409, retryResult.details);
            }
            break;
          }
          throw new RunnerError("OPERATION_IN_PROGRESS", `Operation already exists`, 409);
        }
        case "IDEMPOTENCY_CONFLICT":
          throw new RunnerError(
            "IDEMPOTENCY_CONFLICT" satisfies OperationErrorCode,
            `Idempotency conflict: key ${input.idempotencyKey} was previously used with different params`,
            409,
            createResult.details
          );
        case "WALLET_LOCKED":
          throw new RunnerError(
            "LOCK_CONFLICT" satisfies OperationErrorCode,
            `Wallet ${input.walletAddress} is locked by operation ${(createResult.details as any)?.lockedBy}`,
            409,
            createResult.details
          );
        case "JOB_LOCKED":
          throw new RunnerError(
            "LOCK_CONFLICT" satisfies OperationErrorCode,
            `Job ${input.jobId} is locked by operation ${(createResult.details as any)?.lockedBy}`,
            409,
            createResult.details
          );
      }
    }

    // Update in-memory caches
    this.operations.set(operationId, record);
    this.idempotencyIndex.set(compositeKey, operationId);

    // ── Validate prerequisites ────────────────────────────────────────
    if (!input.walletAddress) {
      const rec = this.operations.get(operationId)!;
      rec.state = "failed";
      rec.errorCode = "BROADCAST_FAILED";
      rec.errorMessage = "circleWalletAddress not configured";
      this.journal.finalizeOperation(operationId, {
        state: "failed",
        errorCode: "BROADCAST_FAILED",
        errorMessage: "circleWalletAddress not configured",
      });
      return this.buildResult(operationId);
    }

    // ── Policy guard (spend enforcement) ───────────────────────────
    if (input.policy && this.policyGuard) {
      this.policyGuard.assertAllowed({
        walletAddress: input.walletAddress,
        agentId: input.agentId ?? this.config.agentId,
        action: input.policy.action,
        contract: input.contractAddress,
        method: input.policy.method,
        amountUsdc: input.policy.amountUsdc,
      });
      if (input.policy.amountUsdc && input.policy.amountUsdc !== "0") {
        this.policyGuard.reserveSpend({
          walletAddress: input.walletAddress,
          agentId: input.agentId ?? this.config.agentId,
          action: input.policy.action,
          amountUsdc: input.policy.amountUsdc,
          operationId,
          idempotencyKey: input.idempotencyKey,
        });
      }
    }

    // ── Execute wallet write ──────────────────────────────────────
    // Update in-memory state to executing
    this.operations.get(operationId)!.state = "executing";

    let cliResult: WalletExecuteResult | undefined;
    let cliError: Error | undefined;

    try {
      cliResult = await executeFn(this.wallet, signal, input.idempotencyKey);
    } catch (error) {
      cliError = error instanceof Error ? error : new Error(String(error));
    }

    // ── Classify and finalize atomically ─────────────────────────────
    const terminalState = classifyCircleResult(cliResult!, cliError);
    const txHash = cliResult ? extractTxHash(cliResult) : undefined;
    const compact = cliResult ? compactCircleResult(cliResult) : undefined;

    let errorCode: OperationErrorCode | undefined;
    let errorMessage: string | undefined;

    if (terminalState === "failed") {
      errorCode = "BROADCAST_FAILED";
      errorMessage = cliError?.message ?? "Wallet write failed";
    }
    if (terminalState === "unknown") {
      errorCode = "UNKNOWN_TX_STATE";
      errorMessage = "Wallet write timeout or ambiguous result — tx may have been broadcast";
    }

    // Atomic finalization: state + txHash + result + receipt + lock release
    this.journal.finalizeOperation(operationId, {
      state: terminalState === "confirmed" ? "confirmed" : terminalState,
      txHash: txHash ?? undefined,
      errorCode,
      errorMessage,
      result: compact ? { stdout: compact.stdout, stderr: compact.stderr, json: compact.json } : undefined,
    });

    // Update in-memory
    const recordFinal = this.operations.get(operationId)!;
    recordFinal.state = terminalState === "confirmed" ? "confirmed" : terminalState;
    if (txHash) recordFinal.txHash = txHash;
    if (errorCode) recordFinal.errorCode = errorCode;
    if (errorMessage) recordFinal.errorMessage = errorMessage;

    if (compact) {
      this.resultCache.set(operationId, compact);
      // Evict oldest
      while (this.resultCache.size > MAX_RESULT_CACHE_ENTRIES) {
        const oldestKey = this.resultCache.keys().next().value;
        if (!oldestKey) break;
        this.resultCache.delete(oldestKey);
      }
    }

    return this.buildResult(operationId, cliResult);
  }

  // ── Query ──────────────────────────────────────────────────────────

  getOperation(operationId: string): OperationRecord | undefined {
    return this.operations.get(operationId);
  }

  getOperationsByState(state: OperationState): OperationRecord[] {
    const results: OperationRecord[] = [];
    for (const record of this.operations.values()) {
      if (record.state === state) results.push(record);
    }
    return results;
  }

  get operationCount(): number {
    return this.operations.size;
  }

  get resultCacheSize(): number {
    return this.resultCache.size;
  }

  // ── Reconciliation ─────────────────────────────────────────────────

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

    // Atomic reconciliation via journal
    this.journal.reconcileOperation(operationId, outcome, details);

    // Update in-memory
    if (details?.txHash) record.txHash = details.txHash;
    if (outcome === "confirmed") {
      record.state = "confirmed";
      record.errorCode = undefined;
      record.errorMessage = undefined;
    } else if (outcome === "failed") {
      record.state = "failed";
      record.errorCode = details?.errorCode ?? "BROADCAST_FAILED";
      record.errorMessage = details?.errorMessage ?? "Reconciled as failed";
    } else {
      record.state = "unknown";
      if (details?.errorCode) record.errorCode = details.errorCode;
      if (details?.errorMessage) record.errorMessage = details.errorMessage;
    }
    record.updatedAt = new Date().toISOString();

    return record;
  }

  /** Get all operations that need reconciliation. */
  getReconcilableOperations(): ReconcilableOperation[] {
    return this.journal.getReconcilableOperations();
  }

  // ── Receipt Linkage ────────────────────────────────────────────────

  /**
   * Store receipt proof metadata against an operation.
   * Called after RunnerServices appends a receipt.
   */
  storeReceipt(
    operationId: string,
    receipt: { receiptId?: string; receiptHash?: string; proofKind?: string; proofData?: unknown }
  ): void {
    this.journal.finalizeOperation(operationId, {
      state: this.operations.get(operationId)?.state ?? "confirmed",
      receipt,
    });
  }

  private buildResult(
    operationId: string,
    circleResult?: WalletExecuteResult
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

  // ── Cleanup ────────────────────────────────────────────────────────

  close(): void {
    this.journal.close();
  }
}

// Avoid ESM circular import — import type only
import type { JournalOperationRow } from "./operation-journal";

// ── Gateway Result Assertion ──────────────────────────────────────────

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
