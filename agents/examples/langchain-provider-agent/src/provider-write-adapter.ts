/**
 * Provider Write Adapter Interface
 *
 * Abstraction for direct on-chain writes from provider runtime.
 * Replaces Runner HTTP calls for submit and setBudget.
 *
 * Implementations:
 *   - provider-write-circle.ts (Circle Dev Wallet SDK)
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type WriteResult = {
  ok: boolean;
  txHash?: string;
  operationState?: string;
  error?: string;
};

export type OnChainBudget = {
  hasBudget: boolean;
  budgetAtomic: string;
  budgetUsdc: string;
};

// ── Interface ──────────────────────────────────────────────────────────────

/**
 * ProviderWriteAdapter — direct on-chain writes for provider runtime.
 *
 * Production implementation uses Circle Dev Wallet SDK.
 * No Runner dependency. No HMAC. No remote HTTP.
 */
export interface ProviderWriteAdapter {
  /**
   * Submit deliverableHash on-chain via submit(uint256,bytes32,bytes).
   * Returns txHash on success. No fake txHash — must be real on-chain result.
   */
  submit(input: {
    jobId: string;
    deliverableHash: `0x${string}`;
    agentId: string;
  }): Promise<WriteResult>;

  /**
   * Set budget on-chain via setBudget(uint256,uint256,bytes).
   * Only available when PROVIDER_ALLOW_SET_BUDGET=true.
   * Default production flow: provider does NOT set budget.
   */
  setBudget?(input: {
    jobId: string;
    amount: string;
    reason?: string;
  }): Promise<WriteResult>;

  /**
   * Check on-chain budget status for a job.
   * Read-only — no state mutation.
   */
  checkOnChainBudget(jobId: string): Promise<OnChainBudget>;
}

// ── TODO: EvaluatorWriteAdapter ────────────────────────────────────────────
// Placeholder for Phase 4 (evaluator direct mode). Not implemented in this PR.
//
// export interface EvaluatorWriteAdapter {
//   complete(input: { jobId: string; deliverableHash: `0x${string}`; reason?: `0x${string}` }): Promise<WriteResult>;
//   reject(input: { jobId: string; deliverableHash: `0x${string}`; reason?: `0x${string}` }): Promise<WriteResult>;
// }
