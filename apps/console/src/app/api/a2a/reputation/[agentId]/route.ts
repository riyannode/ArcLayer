import { humanJson } from '@/lib/api/human-json';
import { indexerUrl } from '@/lib/indexer';
import { getErc8183AgentReputationMap, type Erc8183AgentReputation } from '@/lib/erc8183/agent-reputation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const tokenId = decodeURIComponent(agentId || '').trim();

  if (!/^\d+$/.test(tokenId)) {
    return humanJson(_request, {
        ok: false,
        agentId: tokenId,
        score: '0',
        stats: null,
        feedback: [],
        source: 'erc8004_reputation_indexer',
        error: 'invalid_erc8004_token_id',
        reputation: {
          score: '0',
          stats: null,
          feedback: [],
          source: 'erc8004_reputation_indexer',
        },
      }, { status: 200 });
  }

  // Check computed ERC-8183 reputation first
  let erc8183Rep: Erc8183AgentReputation | null = null;
  try {
    const repMap = await getErc8183AgentReputationMap([tokenId]);
    erc8183Rep = repMap.get(tokenId) ?? null;
  } catch {
    // Non-blocking
  }

  try {
    const res = await fetch(indexerUrl(`/reputation/${tokenId}`), {
      cache: 'no-store',
    });

    if (!res.ok) {
      // If indexer has no data but we have ERC-8183 reputation, return that
      if (erc8183Rep && erc8183Rep.totalJobs > 0) {
        return humanJson(_request, {
          ok: true,
          agentId: tokenId,
          tokenId,
          score: String(erc8183Rep.score),
          stats: { callsServed: erc8183Rep.completedJobs, reputationScore: String(erc8183Rep.score) },
          feedback: [],
          source: 'erc8183_agent_jobs',
          updatedAt: erc8183Rep.updatedAt,
          reputation: {
            score: String(erc8183Rep.score),
            tier: erc8183Rep.tier,
            stats: { callsServed: erc8183Rep.completedJobs, reputationScore: String(erc8183Rep.score) },
            feedback: [],
            source: 'erc8183_agent_jobs',
            updatedAt: erc8183Rep.updatedAt,
          },
        });
      }

      const score = '0';
      return humanJson(_request, {
        ok: true,
        agentId: tokenId,
        tokenId,
        score,
        stats: null,
        feedback: [],
        source: 'erc8004_reputation_indexer',
        reputation: {
          score,
          stats: null,
          feedback: [],
          source: 'erc8004_reputation_indexer',
        },
      });
    }

    const data = await res.json();

    // Use ERC-8183 score when available (real job activity), indexer score as fallback
    const indexerScore = data.averageScore ?? '0';
    const score = erc8183Rep && erc8183Rep.totalJobs > 0
      ? String(erc8183Rep.score)
      : indexerScore;
    const source = erc8183Rep && erc8183Rep.totalJobs > 0
      ? 'erc8183_agent_jobs'
      : 'erc8004_reputation_indexer';

    const stats = {
      callsServed: data.feedbackCount ?? 0,
      callsFailed: 0,
      signalsCorrect: 0,
      signalsWrong: 0,
      cumulativePnlBps: 0,
      calibrationScore: 0,
      totalRevenue: '0',
      reputationScore: score,
    };
    const feedback = data.events ?? [];
    const updatedAt = erc8183Rep?.updatedAt ?? data.updatedAt ?? null;

    return humanJson(_request, {
      ok: true,
      agentId: tokenId,
      tokenId,
      score,
      stats,
      feedback,
      source,
      updatedAt,
      reputation: {
        score,
        tier: erc8183Rep?.tier,
        stats,
        feedback,
        source,
        updatedAt,
      },
    });
  } catch (error) {
    // If indexer fails but we have ERC-8183 reputation, return that
    if (erc8183Rep && erc8183Rep.totalJobs > 0) {
      return humanJson(_request, {
        ok: true,
        agentId: tokenId,
        tokenId,
        score: String(erc8183Rep.score),
        stats: { callsServed: erc8183Rep.completedJobs, reputationScore: String(erc8183Rep.score) },
        feedback: [],
        source: 'erc8183_agent_jobs',
        updatedAt: erc8183Rep.updatedAt,
        reputation: {
          score: String(erc8183Rep.score),
          tier: erc8183Rep.tier,
          stats: { callsServed: erc8183Rep.completedJobs, reputationScore: String(erc8183Rep.score) },
          feedback: [],
          source: 'erc8183_agent_jobs',
          updatedAt: erc8183Rep.updatedAt,
        },
      });
    }

    const score = '0';
    const message = error instanceof Error ? error.message : 'reputation_indexer_unavailable';

    return humanJson(_request, {
      ok: false,
      agentId: tokenId,
      tokenId,
      score,
      stats: null,
      feedback: [],
      source: 'erc8004_reputation_indexer',
      error: message,
      reputation: {
        score,
        stats: null,
        feedback: [],
        source: 'erc8004_reputation_indexer',
      },
    });
  }
}
