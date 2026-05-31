import { indexerUrl } from '@/lib/indexer';
import { AgentMatchCandidate, rankAgentsForJob, JobMatchInput } from './match-agents';
import {
  arcTestnet,
  buildGiveFeedbackConfig,
  publicClient,
} from '@arclayer/sdk';
import {
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

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

// ─── ERC-8004 Feedback Write Layer ───────────────────────────────────────────

export type ReputationFeedbackInput = {
  agentTokenId: string | number | bigint;
  score: string | number | bigint;
  category?: string | number;
  comment?: string;
  metadataURI?: string;
  proofURI?: string;
  context?: string;
  ref?: Hex;
  jobId?: string;
};

function normalizePrivateKey(value: string | undefined): `0x${string}` | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed as `0x${string}`;
  return null;
}

function parseBigIntField(value: unknown, name: string): bigint {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name}_required`);
  }

  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`${name}_must_be_integer`);
    return BigInt(value);
  }

  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new Error(`${name}_must_be_integer_string`);
    }
    return BigInt(value.trim());
  }

  throw new Error(`${name}_invalid`);
}

function parseCategory(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isInteger(parsed)) throw new Error('category_must_be_integer');
  if (parsed < 0 || parsed > 255) throw new Error('category_out_of_uint8_range');

  return parsed;
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function normalizeFeedbackRef(input: {
  agentTokenId?: unknown;
  score?: unknown;
  category?: unknown;
  jobId?: string;
  context?: string;
  comment?: string;
  ref?: Hex;
}): Hex {
  if (isBytes32(input.ref)) return input.ref;

  return keccak256(
    toBytes(
      [
        'arclayer-feedback',
        String(input.agentTokenId ?? ''),
        String(input.score ?? ''),
        String(input.category ?? ''),
        input.jobId || '',
        input.context || '',
        input.comment || '',
        Date.now().toString(),
      ].join(':'),
    ),
  );
}

export function buildReputationFeedback(input: ReputationFeedbackInput) {
  const agentTokenId = parseBigIntField(input.agentTokenId, 'agentTokenId');
  const score = parseBigIntField(input.score, 'score');
  const category = parseCategory(input.category);

  if (agentTokenId <= 0n) throw new Error('agentTokenId_must_be_positive');

  if (score < -1000n || score > 1000n) {
    throw new Error('score_out_of_manual_test_range');
  }

  const comment = String(input.comment || 'Manual ArcLayer reputation feedback').slice(0, 500);
  const metadataURI = String(input.metadataURI || '');
  const proofURI = String(input.proofURI || 'arclayer://proof/manual-feedback');
  const context = String(input.context || 'manual-reputation-feedback').slice(0, 200);

  const ref = normalizeFeedbackRef({
    agentTokenId: input.agentTokenId,
    score: input.score,
    category: input.category,
    jobId: input.jobId,
    context,
    comment,
    ref: input.ref,
  });

  const config = buildGiveFeedbackConfig(
    agentTokenId,
    score,
    category,
    comment,
    metadataURI,
    proofURI,
    context,
    ref,
  );

  return {
    agentTokenId,
    score,
    category,
    comment,
    metadataURI,
    proofURI,
    context,
    ref,
    config,
  };
}

export async function writeReputationFeedback(input: ReputationFeedbackInput) {
  const feedback = buildReputationFeedback(input);
  const pk = normalizePrivateKey(
    process.env.REPUTATION_FEEDBACK_PRIVATE_KEY ||
    process.env.REPUTATION_ORACLE_PK,
  );

  if (!pk) {
    throw new Error('missing_or_invalid_REPUTATION_FEEDBACK_PRIVATE_KEY');
  }

  const account = privateKeyToAccount(pk);

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL),
  });

  const txHash = await walletClient.writeContract(feedback.config);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 60_000,
  });

  return {
    ok: true,
    source: 'erc8004_reputation_registry',
    agentTokenId: feedback.agentTokenId.toString(),
    score: feedback.score.toString(),
    category: feedback.category,
    comment: feedback.comment,
    metadataURI: feedback.metadataURI,
    proofURI: feedback.proofURI,
    context: feedback.context,
    ref: feedback.ref,
    txHash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    reviewer: account.address,
  };
}

function extractAgentTokenId(value: string): string | null {
  const raw = String(value || '').trim();

  if (/^\d+$/.test(raw)) return raw;

  const colonMatch = raw.match(/:(\d+)$/);
  if (colonMatch?.[1]) return colonMatch[1];

  return null;
}

// ─── Public API: recordDelivery ──────────────────────────────────────────────

export async function recordDelivery(opts: {
  providerAgentId: string;
  buyerAgentId: string;
  jobId: string;
  amount?: bigint;
  delivered: boolean;
}): Promise<{ txHash?: string; error?: string }> {
  const agentTokenId = extractAgentTokenId(opts.providerAgentId);

  if (!agentTokenId) {
    console.warn(
      `[recordDelivery] could not extract tokenId from providerAgentId=${opts.providerAgentId}, jobId=${opts.jobId}`,
    );
    return { error: 'provider_agent_token_id_required' };
  }

  try {
    const result = await writeReputationFeedback({
      agentTokenId,
      score: opts.delivered ? 100 : -100,
      category: 1,
      comment: opts.delivered ? 'job_delivered' : 'job_failed',
      metadataURI: `arclayer://jobs/${encodeURIComponent(opts.jobId)}`,
      proofURI: `arclayer://proof/job/${encodeURIComponent(opts.jobId)}`,
      context: 'erc8183_job_delivery',
      jobId: opts.jobId,
    });

    return { txHash: result.txHash };
  } catch (error) {
    console.error(
      `[recordDelivery] writeReputationFeedback failed for agentTokenId=${agentTokenId}, jobId=${opts.jobId}:`,
      error instanceof Error ? error.message : error,
    );
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
