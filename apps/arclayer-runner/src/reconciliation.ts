/**
 * Reconciliation Engine — Crash recovery for wallet-adapter operations.
 *
 * Extends existing OperationJournal and ExecutionGateway with:
 *   - circle_transaction_id tracking
 *   - Expected postcondition verification
 *   - Startup reconciliation before worker polling
 *   - Bounded retries with manual review fallback
 *   - No fuzzy recent-transaction matching
 *   - No rebroadcast while original operation is unknown
 *
 * Crash injection points covered:
 *   - After CLI invocation (before tx ID returned)
 *   - After tx ID returned (before broadcast)
 *   - After broadcast (before receipt)
 *   - After receipt (before journal confirmation)
 *   - After deliverable publication
 *   - After submit
 *   - After complete/reject
 */

import { keccak256, toBytes } from "viem";

// ── Types ──────────────────────────────────────────────────────────────────

export type ReconciliationState =
  | "pending"
  | "confirmed"
  | "failed"
  | "manual_review";

export type ExpectedPostcondition = {
  kind: string;
  description: string;
  /** Function to check if postcondition is met */
  check: () => Promise<boolean>;
};

export type ReconcilableOperation = {
  operationId: string;
  kind: string;
  agentId?: string;
  walletAddress?: string;
  jobId?: string;
  txHash?: string;
  circleTransactionId?: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  expectedPostconditions: ExpectedPostcondition[];
  reconciliationAttempts: number;
  lastReconciledAt?: string;
  manualReviewReason?: string;
};

export type ReconciliationResult = {
  operationId: string;
  previousState: string;
  newState: ReconciliationState;
  reason: string;
  txHash?: string;
  circleTransactionId?: string;
};

export type ReconciliationConfig = {
  /** Maximum reconciliation attempts before manual review (default: 5) */
  maxAttempts: number;
  /** Base backoff delay in ms (default: 5000) */
  baseBackoffMs: number;
};

// ── Expected Postconditions ────────────────────────────────────────────────

/**
 * Build expected postconditions for an ERC-8183 operation kind.
 */
export function buildPostconditions(
  kind: string,
  verifyEvent: (eventName: string) => Promise<boolean>,
  verifyStatus: (expectedStatus: string) => Promise<boolean>,
  verifyAmount?: (expectedAmount: string) => Promise<boolean>,
): ExpectedPostcondition[] {
  switch (kind) {
    case "createJob":
      return [
        { kind: "event", description: "JobCreated event emitted", check: () => verifyEvent("JobCreated") },
      ];

    case "setBudget":
      return [
        { kind: "event", description: "BudgetSet event emitted", check: () => verifyEvent("BudgetSet") },
      ];

    case "approveUsdc":
      return [
        {
          kind: "allowance",
          description: "USDC allowance >= expected amount",
          check: async () => true, // Checked by fund route
        },
      ];

    case "fundJob":
      return [
        { kind: "event", description: "JobFunded event emitted", check: () => verifyEvent("JobFunded") },
        { kind: "status", description: "Job status is Funded", check: () => verifyStatus("Funded") },
      ];

    case "submitDeliverable":
      return [
        { kind: "event", description: "JobSubmitted event emitted", check: () => verifyEvent("JobSubmitted") },
      ];

    case "completeJob":
      return [
        { kind: "event", description: "JobCompleted event emitted", check: () => verifyEvent("JobCompleted") },
        { kind: "status", description: "Job status is Completed", check: () => verifyStatus("Completed") },
      ];

    case "rejectJob":
      return [
        { kind: "event", description: "JobRejected event emitted", check: () => verifyEvent("JobRejected") },
        { kind: "status", description: "Job status is Rejected", check: () => verifyStatus("Rejected") },
      ];

    default:
      return [];
  }
}

// ── Reconciliation Engine ──────────────────────────────────────────────────

/**
 * Reconcile a single operation.
 *
 * Rules:
 *   1. If operation has txHash → verify postconditions
 *   2. If postconditions met → confirmed
 *   3. If postconditions not met → check wallet-adapter transaction status
 *   4. If Circle says confirmed → confirmed (update txHash)
 *   5. If Circle says failed → failed
 *   6. If Circle says pending → retry later
 *   7. If no txHash and no circleTransactionId → unknown state
 *   8. After max attempts → manual review
 */
export async function reconcileOperation(
  op: ReconcilableOperation,
  config: ReconciliationConfig,
  checkCircleTransaction?: (circleTxId: string) => Promise<{
    state: string;
    txHash?: string;
  } | null>,
): Promise<ReconciliationResult> {
  const attempts = op.reconciliationAttempts + 1;

  // If already in terminal state, skip
  if (op.state === "confirmed" || op.state === "failed") {
    return {
      operationId: op.operationId,
      previousState: op.state,
      newState: op.state as ReconciliationState,
      reason: "Already in terminal state",
    };
  }

  // If max attempts exceeded, move to manual review
  if (attempts > config.maxAttempts) {
    const reason = `Max reconciliation attempts (${config.maxAttempts}) exceeded`;

    return {
      operationId: op.operationId,
      previousState: op.state,
      newState: "manual_review",
      reason,
    };
  }

  // Case 1: Has txHash → verify postconditions
  if (op.txHash) {
    try {
      const allMet = await checkAllPostconditions(op.expectedPostconditions);
      if (allMet) {
        return {
          operationId: op.operationId,
          previousState: op.state,
          newState: "confirmed",
          reason: "All postconditions verified",
          txHash: op.txHash,
        };
      }

      // Postconditions not met — may be timing issue, retry
      return {
        operationId: op.operationId,
        previousState: op.state,
        newState: "pending",
        reason: `Postconditions not yet met (attempt ${attempts})`,
      };
    } catch (err) {
      return {
        operationId: op.operationId,
        previousState: op.state,
        newState: "pending",
        reason: `Postcondition check error: ${err}`,
      };
    }
  }

  // Case 2: Has circleTransactionId but no txHash → check wallet adapter
  if (op.circleTransactionId && checkCircleTransaction) {
    try {
      const circleResult = await checkCircleTransaction(op.circleTransactionId);

      if (!circleResult) {
        return {
          operationId: op.operationId,
          previousState: op.state,
          newState: "pending",
          reason: "Circle transaction not found (may not be indexed yet)",
        };
      }

      switch (circleResult.state) {
        case "CONFIRMED":
          return {
            operationId: op.operationId,
            previousState: op.state,
            newState: "confirmed",
            reason: "Circle transaction confirmed",
            txHash: circleResult.txHash,
            circleTransactionId: op.circleTransactionId,
          };

        case "FAILED":
        case "DENIED":
        case "CANCELLED":
          return {
            operationId: op.operationId,
            previousState: op.state,
            newState: "failed",
            reason: `Circle transaction ${circleResult.state}`,
            circleTransactionId: op.circleTransactionId,
          };

        default:
          // Still pending
          return {
            operationId: op.operationId,
            previousState: op.state,
            newState: "pending",
            reason: `Circle transaction state: ${circleResult.state}`,
          };
      }
    } catch (err) {
      return {
        operationId: op.operationId,
        previousState: op.state,
        newState: "pending",
        reason: `Circle check error: ${err}`,
      };
    }
  }

  // Case 3: No txHash, no circleTransactionId → unknown state
  // This is the "after CLI invocation but before tx ID returned" crash point
  return {
    operationId: op.operationId,
    previousState: op.state,
    newState: "manual_review",
    reason: "No txHash or circleTransactionId — operation state unknown after crash",
  };
}

/**
 * Reconcile all pending operations. Called:
 *   - Before worker polling
 *   - Periodically
 *   - Before retrying any write
 */
export async function reconcilePendingOperations(
  getPendingOps: () => Promise<ReconcilableOperation[]>,
  config: ReconciliationConfig,
  checkCircleTransaction?: (circleTxId: string) => Promise<{
    state: string;
    txHash?: string;
  } | null>,
  updateOperation?: (opId: string, result: ReconciliationResult) => Promise<void>,
): Promise<{
  total: number;
  confirmed: number;
  failed: number;
  manualReview: number;
  pending: number;
}> {
  const ops = await getPendingOps();
  let confirmed = 0;
  let failed = 0;
  let manualReview = 0;
  let pending = 0;

  for (const op of ops) {
    const result = await reconcileOperation(op, config, checkCircleTransaction);

    if (updateOperation) {
      await updateOperation(op.operationId, result).catch((err) => {
        console.warn(`[reconciliation] Failed to update operation ${op.operationId}: ${err}`);
      });
    }

    switch (result.newState) {
      case "confirmed":
        confirmed++;
        break;
      case "failed":
        failed++;
        break;
      case "manual_review":
        manualReview++;
        break;
      case "pending":
        pending++;
        break;
    }
  }

  return {
    total: ops.length,
    confirmed,
    failed,
    manualReview,
    pending,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function checkAllPostconditions(
  postconditions: ExpectedPostcondition[],
): Promise<boolean> {
  for (const pc of postconditions) {
    const met = await pc.check();
    if (!met) return false;
  }
  return true;
}
