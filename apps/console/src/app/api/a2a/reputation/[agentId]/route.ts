import { NextRequest, NextResponse } from 'next/server';
import { getReputationScore, getAgentStats } from '@/lib/a2a/reputation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/a2a/reputation/[agentId] — public reputation lookup.
 * Returns on-chain reputation score + stats for an agent.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<NextResponse> {
  const { agentId } = await params;

  if (!agentId) {
    return NextResponse.json({ ok: false, error: 'missing_agent_id' }, { status: 400 });
  }

  const [score, stats] = await Promise.all([
    getReputationScore(agentId),
    getAgentStats(agentId),
  ]);

  return NextResponse.json({
    ok: true,
    agentId,
    reputation: {
      score: score.toString(),
      stats: stats
        ? {
            callsServed: stats.callsServed.toString(),
            callsFailed: stats.callsFailed.toString(),
            signalsCorrect: stats.signalsCorrect.toString(),
            signalsWrong: stats.signalsWrong.toString(),
            cumulativePnlBps: stats.cumulativePnlBps.toString(),
            calibrationScore: stats.calibrationScore.toString(),
            totalRevenue: stats.totalRevenue.toString(),
          }
        : null,
    },
  });
}
