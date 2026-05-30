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
        agentId: tokenId,
        score: '0',
        stats: null,
        source: 'erc8004_reputation_indexer',
        error: 'invalid_erc8004_token_id',
      },
      { status: 200 }
    );
  }

  try {
    const res = await fetch(indexerUrl(`/reputation/${tokenId}`), {
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json({
        agentId: tokenId,
        score: '0',
        stats: null,
        source: 'erc8004_reputation_indexer',
      });
    }

    const data = await res.json();

    return NextResponse.json({
      agentId: tokenId,
      tokenId,
      score: data.averageScore ?? '0',
      stats: {
        callsServed: data.feedbackCount ?? 0,
        callsFailed: 0,
        signalsCorrect: 0,
        signalsWrong: 0,
        cumulativePnlBps: 0,
        calibrationScore: 0,
        totalRevenue: '0',
        reputationScore: data.averageScore ?? '0',
      },
      feedback: data.events ?? [],
      source: 'erc8004_reputation_indexer',
      updatedAt: data.updatedAt ?? null,
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
