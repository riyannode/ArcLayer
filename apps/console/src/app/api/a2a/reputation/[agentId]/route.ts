import { NextResponse } from 'next/server';
import { indexerUrl } from '@/lib/indexer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const tokenId = decodeURIComponent(agentId || '').trim();

  if (!/^\d+$/.test(tokenId)) {
    return NextResponse.json(
      {
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
      },
      { status: 200 }
    );
  }

  try {
    const res = await fetch(indexerUrl(`/reputation/${tokenId}`), {
      cache: 'no-store',
    });

    if (!res.ok) {
      const score = '0';
      return NextResponse.json({
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

    const score = data.averageScore ?? '0';
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
    const updatedAt = data.updatedAt ?? null;

    return NextResponse.json({
      ok: true,
      agentId: tokenId,
      tokenId,
      score,
      stats,
      feedback,
      source: 'erc8004_reputation_indexer',
      updatedAt,
      reputation: {
        score,
        stats,
        feedback,
        source: 'erc8004_reputation_indexer',
        updatedAt,
      },
    });
  } catch (error) {
    return NextResponse.json({
      agentId: tokenId,
      score: '0',
      stats: null,
      source: 'erc8004_reputation_indexer',
      error: error instanceof Error ? error.message : 'reputation_indexer_unavailable',
    });
  }
}
