/**
 * ArcChainReader — direct onchain read access for autonomy workers.
 *
 * Uses viem public client + SDK constants. No Circle CLI dependency for reads.
 * All autonomy workers verify onchain state through this reader BEFORE taking action.
 */
import {
  createPublicClient,
  http,
  type PublicClient,
  type Hash,
  type Address,
  type TransactionReceipt,
} from "viem";
import {
  CONTRACTS,
  ARC_CHAIN_ID,
  ERC8183_AGENTIC_COMMERCE_ABI,
  USDC_ABI,
  type OnchainJob,
  JOB_STATUS,
  type OperationExpectation,
} from "@arclayer/runner-core";

// Re-export for consumers
export type { OnchainJob };

/**
 * ArcChainReader provides direct onchain reads for autonomy workers.
 *
 * Invariants:
 * - Verifies chain ID at startup
 * - Refuses writes (read-only)
 * - Uses SDK ABI constants (never duplicated)
 */
export class ArcChainReader {
  private readonly client: PublicClient;
  private readonly rpcUrl: string;
  private chainVerified = false;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
    this.client = createPublicClient({
      transport: http(rpcUrl),
    });
  }

  /**
   * Verify chain ID matches Arc Testnet. Must be called before any reads.
   * Throws if chain ID doesn't match.
   */
  async verifyChain(): Promise<void> {
    const chainId = await this.client.getChainId();
    if (chainId !== ARC_CHAIN_ID) {
      throw new Error(
        `Chain ID mismatch: expected ${ARC_CHAIN_ID} (Arc Testnet), got ${chainId}. ` +
        `RPC: ${this.rpcUrl}`
      );
    }
    this.chainVerified = true;
  }

  private assertChainVerified(): void {
    if (!this.chainVerified) {
      throw new Error("Chain not verified. Call verifyChain() first.");
    }
  }

  /**
   * Read a job from the AgenticCommerce contract.
   */
  async getJob(jobId: string): Promise<OnchainJob> {
    this.assertChainVerified();
    const result = await this.client.readContract({
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
      abi: ERC8183_AGENTIC_COMMERCE_ABI,
      functionName: "getJob",
      args: [BigInt(jobId)],
    });

    // Contract returns: [id, client, provider, evaluator, description, budget, expiredAt, status, hook]
    const arr = result as readonly bigint[];
    return {
      id: arr[0] as bigint,
      client: arr[1] as unknown as `0x${string}`,
      provider: arr[2] as unknown as `0x${string}`,
      evaluator: arr[3] as unknown as `0x${string}`,
      description: arr[4] as unknown as string,
      budget: arr[5] as bigint,
      expiredAt: arr[6] as bigint,
      status: Number(arr[7]),
      hook: arr[8] as unknown as `0x${string}`,
    };
  }

  /**
   * Read USDC balance for an address.
   */
  async getUsdcBalance(address: `0x${string}`): Promise<bigint> {
    this.assertChainVerified();
    return this.client.readContract({
      address: CONTRACTS.USDC as Address,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [address],
    }) as Promise<bigint>;
  }

  /**
   * Read USDC allowance from owner to spender.
   */
  async getUsdcAllowance(
    owner: `0x${string}`,
    spender: `0x${string}`
  ): Promise<bigint> {
    this.assertChainVerified();
    return this.client.readContract({
      address: CONTRACTS.USDC as Address,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [owner, spender],
    }) as Promise<bigint>;
  }

  /**
   * Get transaction receipt by hash.
   */
  async getTransactionReceipt(txHash: `0x${string}`): Promise<TransactionReceipt | null> {
    this.assertChainVerified();
    try {
      return await this.client.getTransactionReceipt({ hash: txHash as Hash });
    } catch {
      return null;
    }
  }

  /**
   * Wait for a transaction receipt with timeout.
   */
  async waitForTransactionReceipt(
    txHash: `0x${string}`,
    timeoutMs = 60000
  ): Promise<TransactionReceipt> {
    this.assertChainVerified();
    return this.client.waitForTransactionReceipt({
      hash: txHash as Hash,
      timeout: timeoutMs,
    });
  }

  /**
   * Resolve the JobCreated event from a transaction receipt.
   * Returns the jobId if found, undefined otherwise.
   */
  async resolveCreatedJobId(txHash: `0x${string}`): Promise<string | undefined> {
    this.assertChainVerified();
    const receipt = await this.getTransactionReceipt(txHash);
    if (!receipt) return undefined;

    // Look for JobCreated event in logs
    // JobCreated(uint256 indexed jobId, address indexed client, address provider, address evaluator)
    const JOB_CREATED_TOPIC = "0xca52e62c"; // First 4 bytes of keccak256("JobCreated(...)")
    for (const log of receipt.logs) {
      if (log.topics[0]?.startsWith(JOB_CREATED_TOPIC) && log.topics[1]) {
        return BigInt(log.topics[1]).toString();
      }
    }
    return undefined;
  }

  /**
   * Get the submitted deliverable hash from a transaction receipt or onchain state.
   */
  async getSubmittedDeliverable(
    jobId: string,
    txHash?: `0x${string}`
  ): Promise<`0x${string}` | null> {
    this.assertChainVerified();

    // First try from tx receipt if provided
    if (txHash) {
      const receipt = await this.getTransactionReceipt(txHash);
      if (receipt) {
        // JobSubmitted(uint256 indexed jobId, bytes32 deliverable)
        const JOB_SUBMITTED_TOPIC = "0xae7362b1";
        for (const log of receipt.logs) {
          if (log.topics[0]?.startsWith(JOB_SUBMITTED_TOPIC) && log.data) {
            return log.data as `0x${string}`;
          }
        }
      }
    }

    // Fallback: read from onchain job state
    const job = await this.getJob(jobId);
    if (job.status >= JOB_STATUS.Submitted) {
      // The deliverable is stored as bytes32 in the job struct
      // For now, we need to get it from the submit event
      return null;
    }
    return null;
  }

  /**
   * Verify an operation expectation against onchain state.
   * Used by the transaction reconciler to confirm writes succeeded.
   */
  async verifyExpectation(
    expectation: OperationExpectation
  ): Promise<{ satisfied: boolean; details: unknown }> {
    this.assertChainVerified();

    switch (expectation.kind) {
      case "job_status": {
        const job = await this.getJob(expectation.jobId);
        const satisfied = job.status === expectation.expectedStatus;
        return {
          satisfied,
          details: {
            expected: expectation.expectedStatus,
            actual: job.status,
            jobId: expectation.jobId,
          },
        };
      }

      case "job_budget": {
        const job = await this.getJob(expectation.jobId);
        const satisfied = job.budget.toString() === expectation.expectedBudget;
        return {
          satisfied,
          details: {
            expected: expectation.expectedBudget,
            actual: job.budget.toString(),
            jobId: expectation.jobId,
          },
        };
      }

      case "job_provider": {
        const job = await this.getJob(expectation.jobId);
        const satisfied = job.provider.toLowerCase() === expectation.expectedProvider.toLowerCase();
        return {
          satisfied,
          details: {
            expected: expectation.expectedProvider,
            actual: job.provider,
            jobId: expectation.jobId,
          },
        };
      }

      case "usdc_allowance": {
        const allowance = await this.getUsdcAllowance(
          expectation.owner as `0x${string}`,
          expectation.spender as `0x${string}`
        );
        const satisfied = allowance >= BigInt(expectation.minimumAmount);
        return {
          satisfied,
          details: {
            expected: expectation.minimumAmount,
            actual: allowance.toString(),
            owner: expectation.owner,
            spender: expectation.spender,
          },
        };
      }

      case "job_created": {
        // This expectation is verified by the JobCreated event in the receipt
        // Not easily verifiable by reading onchain state alone
        return {
          satisfied: false,
          details: { reason: "job_created expectation requires receipt verification" },
        };
      }

      case "submitted_deliverable": {
        const hash = await this.getSubmittedDeliverable(expectation.jobId);
        const satisfied = hash?.toLowerCase() === expectation.deliverableHash.toLowerCase();
        return {
          satisfied,
          details: {
            expected: expectation.deliverableHash,
            actual: hash,
            jobId: expectation.jobId,
          },
        };
      }

      default:
        return {
          satisfied: false,
          details: { reason: `Unknown expectation kind: ${(expectation as any).kind}` },
        };
    }
  }
}
