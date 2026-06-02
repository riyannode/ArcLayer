/**
 * ERC-8183 Transaction Receipt & On-Chain State Helpers.
 *
 * Reads transaction receipts and on-chain job state from the
 * AgenticCommerce contract. Never holds private keys or signs.
 *
 * Flow per plan Correction 6:
 *   1. read transaction receipt
 *   2. confirm receipt status = success
 *   3. optionally read AgenticCommerce.getJob(erc8183_job_id)
 *   4. then update erc8183_status from on-chain state
 */

import { createPublicClient, http, fallback, decodeEventLog, type Address, type Hex, type Log } from 'viem';
import { ARC_CHAIN_ID, ARC_RPC_URLS, CONTRACTS } from '@arclayer/sdk';
import { ERC8183_AGENTIC_COMMERCE_ABI } from '@arclayer/sdk';
import type { Erc8183Status } from './types';

// ── On-chain ERC-8183 status enum mapping ─────────────────────────────────

/**
 * ERC-8183 job status as returned by AgenticCommerce.getJob().
 * The contract returns a uint8. Arc official docs specify these values.
 */
export const ONCHAIN_STATUS_MAP: Record<number, Erc8183Status> = {
  0: 'Open',
  1: 'Funded',
  2: 'Submitted',
  3: 'Completed',
  4: 'Rejected',
  5: 'Expired',
};

// ── Public client ─────────────────────────────────────────────────────────

let _publicClient: ReturnType<typeof createPublicClient> | null = null;

/** Create or return the cached Arc Testnet public client. */
export function getArcPublicClient() {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: {
        id: ARC_CHAIN_ID,
        name: 'Arc Testnet',
        nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
        rpcUrls: {
          default: { http: [...ARC_RPC_URLS] },
          public: { http: [...ARC_RPC_URLS] },
        },
      },
      transport: fallback(ARC_RPC_URLS.map((url) => http(url))),
    });
  }
  return _publicClient;
}

// ── Receipt helpers ───────────────────────────────────────────────────────

export interface ConfirmedReceipt {
  status: 'success' | 'reverted';
  transactionHash: Hex;
  from: Address;
  blockNumber: bigint;
  logs: Log[];
}

/**
 * Read a transaction receipt and confirm it exists.
 * Returns null if the tx hasn't been mined yet (not a fatal error — caller
 * can retry).
 */
export async function readTransactionReceipt(
  txHash: Hex,
): Promise<ConfirmedReceipt | null> {
  const client = getArcPublicClient();
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (!receipt) return null;

  return {
    status: receipt.status === 'success' ? 'success' : 'reverted',
    transactionHash: receipt.transactionHash,
    from: receipt.from,
    blockNumber: receipt.blockNumber,
    logs: receipt.logs,
  };
}

// ── JobCreated event decoding ─────────────────────────────────────────────

export interface JobCreatedEvent {
  jobId: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  expiredAt: bigint;
  hook: Address;
}

/**
 * Decode a JobCreated event from a transaction receipt's logs.
 * Returns null if no matching event is found.
 */
export function decodeJobCreatedFromReceipt(
  receipt: ConfirmedReceipt,
): JobCreatedEvent | null {
  for (const log of receipt.logs) {
    // Match only logs from the AgenticCommerce contract
    if (log.address.toLowerCase() !== CONTRACTS.ERC8183_AGENTIC_COMMERCE.toLowerCase()) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ERC8183_AGENTIC_COMMERCE_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === 'JobCreated') {
        const args = decoded.args as unknown as {
          jobId: bigint;
          client: Address;
          provider: Address;
          evaluator: Address;
          expiredAt: bigint;
          hook: Address;
        };
        return {
          jobId: args.jobId,
          client: args.client,
          provider: args.provider,
          evaluator: args.evaluator,
          expiredAt: args.expiredAt,
          hook: args.hook,
        };
      }
    } catch {
      // Not a decodable event from this ABI, skip
    }
  }

  return null;
}

// ── On-chain job state reader ─────────────────────────────────────────────

/**
 * Read the on-chain ERC-8183 job state via AgenticCommerce.getJob().
 * Returns the job record or null if the job doesn't exist.
 */
export async function readOnchainJob(
  erc8183JobId: bigint,
): Promise<{
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: Address;
  erc8183Status: Erc8183Status;
} | null> {
  const client = getArcPublicClient();
  try {
    const result = await client.readContract({
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      abi: ERC8183_AGENTIC_COMMERCE_ABI,
      functionName: 'getJob',
      args: [erc8183JobId],
    });

    const job = result as unknown as {
      id: bigint;
      client: Address;
      provider: Address;
      evaluator: Address;
      description: string;
      budget: bigint;
      expiredAt: bigint;
      status: number;
      hook: Address;
    };

    const erc8183Status = ONCHAIN_STATUS_MAP[Number(job.status)] ?? 'Open';

    return {
      id: job.id,
      client: job.client,
      provider: job.provider,
      evaluator: job.evaluator,
      description: job.description,
      budget: job.budget,
      expiredAt: job.expiredAt,
      status: Number(job.status),
      hook: job.hook,
      erc8183Status,
    };
  } catch {
    return null;
  }
}

/**
 * Convenience: get only the on-chain ERC-8183 status for a job.
 */
export async function readOnchainJobStatus(
  erc8183JobId: bigint,
): Promise<Erc8183Status | null> {
  const job = await readOnchainJob(erc8183JobId);
  return job?.erc8183Status ?? null;
}
