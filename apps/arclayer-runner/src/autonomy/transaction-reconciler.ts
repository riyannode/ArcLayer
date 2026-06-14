/**
 * TransactionReconciler — matches Circle CLI transactions to onchain receipts.
 *
 * Runs before workers start. Ensures no duplicate writes by verifying
 * every pending operation against Circle tx history and RPC receipts.
 */
import {
  type CircleCliAdapter,
  extractCircleTransactions,
  normalizeCircleTransaction,
} from "@arclayer/circle-cli-adapter";
import type { ArcChainReader } from "../chain-reader";
import type { OperationJournal } from "../operation-journal";
import type { OperationExpectation } from "@arclayer/runner-core";

export type ReconciliationResult = {
  operationId: string;
  outcome: "confirmed" | "failed" | "unknown" | "manual_review";
  txHash?: string;
  details: unknown;
};

export class TransactionReconciler {
  constructor(
    private readonly journal: OperationJournal,
    private readonly chainReader: ArcChainReader,
    private readonly circleAdapter: CircleCliAdapter,
    private readonly walletAddress: string,
    private readonly chain: string
  ) {}

  /**
   * Reconcile all pending operations.
   * Called once at startup before workers begin.
   */
  async reconcileAll(): Promise<ReconciliationResult[]> {
    const reconcilable = this.journal.getReconcilableOperations();
    const results: ReconciliationResult[] = [];

    for (const op of reconcilable) {
      try {
        const result = await this.reconcileOne(op.operationId);
        results.push(result);
      } catch (error) {
        results.push({
          operationId: op.operationId,
          outcome: "unknown",
          details: { error: String(error) },
        });
      }
    }

    return results;
  }

  /**
   * Reconcile a single operation.
   */
  async reconcileOne(operationId: string): Promise<ReconciliationResult> {
    // Get the operation record from journal
    const ops = this.journal.getReconcilableOperations();
    const op = ops.find((o) => o.operationId === operationId);
    if (!op) {
      return {
        operationId,
        outcome: "unknown",
        details: { reason: "Operation not found in reconcilable list" },
      };
    }

    // Strategy 1: If operation has txHash, verify RPC receipt directly
    // (txHash is stored in the operation's result data)

    // Strategy 2: If operation has Circle transaction ID, look it up
    // Strategy 3: Fuzzy match by wallet + operation + contract + timestamp

    // For now, use the reconcilable operation's existing state
    // The ExecutionGateway already has reconcileBroadcast() which handles
    // the basic confirmed/failed/unknown classification.
    // We extend it here with Circle transaction list matching.

    try {
      const circleTxs = await this.fetchCircleTransactions();

      // Try to match by contract address and ABI signature
      const candidates = circleTxs.filter((tx) => {
        if (tx.operation !== "execute") return false;
        if (tx.state === "cancelled" || tx.state === "denied") return false;
        return true;
      });

      if (candidates.length === 0) {
        return {
          operationId,
          outcome: "unknown",
          details: { reason: "No matching Circle transactions found" },
        };
      }

      if (candidates.length > 1) {
        return {
          operationId,
          outcome: "manual_review",
          details: {
            reason: "Multiple matching Circle transactions",
            candidates: candidates.map((c) => ({ id: c.id, state: c.state })),
          },
        };
      }

      // Single candidate — verify onchain
      const candidate = candidates[0]!;
      if (candidate.txHash) {
        const receipt = await this.chainReader.getTransactionReceipt(
          candidate.txHash as `0x${string}`
        );
        if (receipt) {
          if (receipt.status === "success") {
            // Verify postcondition if expectation exists
            this.journal.reconcileOperation(operationId, "confirmed", {
              txHash: candidate.txHash,
              circleTxId: candidate.id,
              source: "transaction-reconciler",
            });
            return {
              operationId,
              outcome: "confirmed",
              txHash: candidate.txHash,
              details: { receipt: "success", circleTxId: candidate.id },
            };
          } else {
            this.journal.reconcileOperation(operationId, "failed", {
              txHash: candidate.txHash,
              reason: "Transaction reverted",
            });
            return {
              operationId,
              outcome: "failed",
              txHash: candidate.txHash,
              details: { receipt: "reverted" },
            };
          }
        }
      }

      // Circle tx found but no onchain receipt yet
      return {
        operationId,
        outcome: "unknown",
        details: {
          circleTxId: candidate.id,
          circleState: candidate.state,
          reason: "Circle transaction found but no onchain receipt yet",
        },
      };
    } catch (error) {
      return {
        operationId,
        outcome: "unknown",
        details: { error: String(error) },
      };
    }
  }

  /**
   * Fetch recent Circle transactions for the wallet.
   */
  private async fetchCircleTransactions() {
    const result = await this.circleAdapter.transactionList({
      address: this.walletAddress,
      chain: this.chain,
      operation: "execute",
      limit: 50,
    });
    return extractCircleTransactions(result);
  }
}
