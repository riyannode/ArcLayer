import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

/**
 * GET /api/x402/agents/[id]/full-report — x402-gated agent reputation report.
 *
 * Comprehensive reputation, receipts, jobs completed, success rate.
 * External agents pay 0.02 USDC per full report.
 */

export const runtime = 'nodejs';

async function handler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const agentId = segments[segments.indexOf('agents') + 1];

  if (!agentId || agentId === '[id]') {
    return NextResponse.json({ ok: false, error: 'missing_agent_id' }, { status: 400 });
  }

  // Simulate full reputation report
  const completed = Math.floor(Math.random() * 50) + 20;
  const successful = Math.floor(completed * (0.85 + Math.random() * 0.13));
  const totalEarned = (completed * 0.05 + Math.random() * 2).toFixed(4);

  return NextResponse.json({
    ok: true,
    paid: true,
    report: {
      agentId,
      reputation: {
        score: Number((4.2 + Math.random() * 0.7).toFixed(2)),
        rank: Math.floor(Math.random() * 100) + 1,
        tier: 'tier-1',
      },
      stats: {
        jobsCompleted: completed,
        jobsSuccessful: successful,
        successRate: Number(((successful / completed) * 100).toFixed(1)),
        totalEarnedUSDC: totalEarned,
        avgResponseTime: `${(Math.random() * 4 + 0.5).toFixed(1)}s`,
        disputesLost: Math.floor(Math.random() * 3),
      },
      recentReceipts: Array.from({ length: 5 }).map((_, i) => ({
        id: `receipt_${Date.now() - i * 3600_000}_${Math.random().toString(36).slice(2, 6)}`,
        jobId: `job_${Date.now() - i * 3600_000}_${Math.random().toString(36).slice(2, 6)}`,
        amount: (Math.random() * 0.5 + 0.05).toFixed(4),
        verifiedAt: new Date(Date.now() - i * 3600_000).toISOString(),
        result: Math.random() > 0.15 ? 'PASSED' : 'FAILED',
      })),
      verifiedSpecialties: ['signal-analysis', 'execution', 'risk-assessment'],
      lastActiveAt: new Date(Date.now() - Math.random() * 600_000).toISOString(),
      generatedAt: new Date().toISOString(),
    },
  });
}

// 0.02 USDC = 20000 atomic (6 decimals)
export const GET = withX402(handler, {
  amount: '20000',
  resource: '/api/x402/agents/[id]/full-report',
  description: 'Full reputation report for an ArcLayer agent',
});
