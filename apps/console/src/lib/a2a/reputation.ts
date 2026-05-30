import { indexerUrl } from '@/lib/indexer';
import { AgentMatchCandidate, rankAgentsForJob, JobMatchInput } from './match-agents';

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

type IndexerReputation = {
  agentTokenId: string;
  feedbackCount: number;
  scoreSum: string;
  averageScore: string;
  latestScore?: string;
};

async function fetchReputation(agentId: string): Promise<IndexerReputation | null> {
  if (!/^\d+$/.test(agentId)) return null;

  try {
    const res = await fetch(indexerUrl(`/reputation/${agentId}`), {
      cache: 'no-store',
    });

    if (!res.ok) return null;
    return (await res.json()) as IndexerReputation;
  } catch {
    return null;
  }
}

export function agentIdToBytes32(agentId: string): `0x${string}` {
  // Kept only for old imports during migration.
  // Do not use for ERC-8004 tokenId based reputation.
  const bytes = new TextEncoder().encode(agentId);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .padStart(64, '0')
    .slice(0, 64);

  return `0x${hex}`;
}

export async function getReputationScore(agentId: string): Promise<bigint> {
  const reputation = await fetchReputation(agentId);
  return BigInt(reputation?.averageScore ?? '0');
}

export async function getAgentStats(agentId: string): Promise<AgentStats | null> {
  const reputation = await fetchReputation(agentId);
  if (!reputation) return null;

  return {
    callsServed: BigInt(reputation.feedbackCount ?? 0),
    callsFailed: BigInt(0),
    signalsCorrect: BigInt(0),
    signalsWrong: BigInt(0),
    cumulativePnlBps: BigInt(0),
    calibrationScore: BigInt(0),
    totalRevenue: BigInt(0),
    reputationScore: BigInt(reputation.averageScore ?? '0'),
  };
}

export async function batchGetReputationScores(
  agentIds: string[],
): Promise<Map<string, bigint>> {
  const results = new Map<string, bigint>();

  await Promise.allSettled(
    agentIds.map(async (id) => {
      results.set(id, await getReputationScore(id));
    }),
  );

  return results;
}

export function reputationBoost(score: bigint): number {
  if (score <= BigInt(0)) return 0;
  const capped = score > BigInt(300) ? BigInt(300) : score;
  return Number(capped) / 10;
}

export async function rankAgentsWithReputation(
  job: JobMatchInput,
  agents: AgentMatchCandidate[],
): Promise<(AgentMatchCandidate & { score: number; repScore: bigint })[]> {
  const baseRanked = rankAgentsForJob(job, agents);
  if (baseRanked.length === 0) return [];

  const repScores = await batchGetReputationScores(baseRanked.map((a) => a.agentId));

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
export async function recordDelivery(_opts: {
  providerAgentId: string;
  buyerAgentId: string;
  jobId: string;
  amount?: bigint;
  delivered: boolean;
}): Promise<{ txHash?: string; error?: string }> {
  // Phase 4.1 intentionally disables custom 0x9c97 recordInteraction.
  // Phase 4.2 will add ERC-8004 giveFeedback write flow.
  return { error: 'erc8004_feedback_write_not_enabled' };
}
