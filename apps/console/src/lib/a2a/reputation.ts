import { createPublicClient, createWalletClient, http, toHex, pad, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from '@arclayer/sdk';
import { AgentMatchCandidate, rankAgentsForJob, JobMatchInput } from './match-agents';

// ─── Contract config ─────────────────────────────────────────────────────────
const REPUTATION_REGISTRY = '0x9c97CAE866397d94e295632B3BFCF342ea20f1Cc' as const;

const ABI = [
  {
    type: 'function',
    name: 'getReputation',
    inputs: [{ type: 'bytes32', name: 'agentId' }],
    outputs: [{ type: 'int128' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'recordInteraction',
    inputs: [
      { type: 'bytes32', name: 'providerAgentId' },
      { type: 'bytes32', name: 'buyerAgentId' },
      { type: 'bytes32', name: 'receiptHash' },
      { type: 'uint128', name: 'amount' },
      { type: 'bool', name: 'delivered' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getStats',
    inputs: [{ type: 'bytes32', name: 'agentId' }],
    outputs: [
      {
        type: 'tuple',
        name: '',
        components: [
          { type: 'uint64', name: 'callsServed' },
          { type: 'uint64', name: 'callsFailed' },
          { type: 'uint64', name: 'signalsCorrect' },
          { type: 'uint64', name: 'signalsWrong' },
          { type: 'int128', name: 'cumulativePnlBps' },
          { type: 'uint64', name: 'calibrationScore' },
          { type: 'uint128', name: 'totalRevenue' },
          { type: 'int128', name: 'reputationScore' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

// ─── Client ──────────────────────────────────────────────────────────────────
const client = createPublicClient({
  chain: arcTestnet,
  transport: http(),
}) as unknown as {
  readContract: (args: Record<string, unknown>) => Promise<unknown>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a string agentId to bytes32 (left-padded UTF-8 hex). */
export function agentIdToBytes32(agentId: string): `0x${string}` {
  // Use the hex of the UTF-8 string, padded to 32 bytes
  const hex = toHex(new TextEncoder().encode(agentId));
  return pad(hex, { size: 32 });
}

export type AgentStats = {
  callsServed: bigint;
  callsFailed: bigint;
  signalsCorrect: bigint;
  signalsWrong: bigint;
  cumulativePnlBps: bigint;
  calibrationScore: bigint;
  totalRevenue: bigint;
  reputationScore: bigint;
};

/**
 * Fetch on-chain reputation score for an agent.
 * Returns 0n if agent has no history.
 */
export async function getReputationScore(agentId: string): Promise<bigint> {
  try {
    const result = await client.readContract({
      address: REPUTATION_REGISTRY,
      abi: ABI,
      functionName: 'getReputation',
      args: [agentIdToBytes32(agentId)],
    });
    return result as bigint;
  } catch {
    // Contract call failed (agent not registered, RPC down, etc.)
    return BigInt(0);
  }
}

/**
 * Fetch full stats for an agent.
 */
export async function getAgentStats(agentId: string): Promise<AgentStats | null> {
  try {
    const result = await client.readContract({
      address: REPUTATION_REGISTRY,
      abi: ABI,
      functionName: 'getStats',
      args: [agentIdToBytes32(agentId)],
    });
    const r = result as unknown as AgentStats;
    return {
      callsServed: r.callsServed,
      callsFailed: r.callsFailed,
      signalsCorrect: r.signalsCorrect,
      signalsWrong: r.signalsWrong,
      cumulativePnlBps: r.cumulativePnlBps,
      calibrationScore: r.calibrationScore,
      totalRevenue: r.totalRevenue,
      reputationScore: r.reputationScore,
    };
  } catch {
    return null;
  }
}

/**
 * Batch-fetch reputation scores for multiple agents.
 * Returns a Map<agentId, score>.
 */
export async function batchGetReputationScores(
  agentIds: string[],
): Promise<Map<string, bigint>> {
  const results = new Map<string, bigint>();
  // Parallel fetch with individual error isolation
  await Promise.allSettled(
    agentIds.map(async (id) => {
      const score = await getReputationScore(id);
      results.set(id, score);
    }),
  );
  return results;
}

/**
 * Compute a reputation boost for the matcher scoring.
 * Normalizes on-chain int128 score to a 0-30 bonus range.
 * Negative reputation = 0 bonus (no penalty in matcher, just no boost).
 */
export function reputationBoost(score: bigint): number {
  if (score <= BigInt(0)) return 0;
  // Cap at 300 rep points → 30 bonus. Linear scale.
  const capped = score > BigInt(300) ? BigInt(300) : score;
  return Number(capped) / 10; // 0-30 range
}

/**
 * Rank agents with reputation weighting.
 * First ranks by job-fit score (role/category/capability),
 * then adds on-chain reputation boost to break ties and reward proven agents.
 */
export async function rankAgentsWithReputation(
  job: JobMatchInput,
  agents: AgentMatchCandidate[],
): Promise<(AgentMatchCandidate & { score: number; repScore: bigint })[]> {
  // Step 1: base ranking from match-agents
  const baseRanked = rankAgentsForJob(job, agents);
  if (baseRanked.length === 0) return [];

  // Step 2: fetch reputation scores in parallel
  const repScores = await batchGetReputationScores(baseRanked.map((a) => a.agentId));

  // Step 3: add reputation boost to base score
  return baseRanked
    .map((a) => {
      const repScore = repScores.get(a.agentId) ?? BigInt(0);
      return {
        ...a,
        score: a.score + reputationBoost(repScore),
        repScore,
      };
    })
    .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId));
}

// ─── Write: Record interaction on-chain ──────────────────────────────────────

const ORACLE_PK = process.env.REPUTATION_ORACLE_PK as `0x${string}` | undefined;

function getWalletClient() {
  if (!ORACLE_PK) return null;
  const account = privateKeyToAccount(ORACLE_PK);
  return createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(),
  });
}

/**
 * Record a successful or failed delivery on-chain.
 * Fire-and-forget — errors are logged but don't block the caller.
 */
export async function recordDelivery(opts: {
  providerAgentId: string;
  buyerAgentId: string;
  jobId: string;
  amount?: bigint;
  delivered: boolean;
}): Promise<{ txHash?: string; error?: string }> {
  const wallet = getWalletClient();
  if (!wallet) return { error: 'no_oracle_pk' };

  try {
    const receiptHash = keccak256(toHex(opts.jobId));
    const txHash = await (wallet as unknown as {
      writeContract: (args: Record<string, unknown>) => Promise<string>;
    }).writeContract({
      address: REPUTATION_REGISTRY,
      abi: ABI,
      functionName: 'recordInteraction',
      args: [
        agentIdToBytes32(opts.providerAgentId),
        agentIdToBytes32(opts.buyerAgentId),
        receiptHash,
        opts.amount ?? BigInt(0),
        opts.delivered,
      ],
    });
    return { txHash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[reputation] recordDelivery failed:', msg);
    return { error: msg };
  }
}
