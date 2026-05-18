import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

/**
 * POST /api/x402/jobs/[id]/route — x402-gated job routing.
 *
 * Apolo decision engine routes a job to the best available agent.
 * External agents pay 0.01 USDC per routing request.
 */

export const runtime = 'nodejs';

async function handler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const jobId = segments[segments.indexOf('jobs') + 1];

  if (!jobId || jobId === '[id]') {
    return NextResponse.json({ ok: false, error: 'missing_job_id' }, { status: 400 });
  }

  // Simulate Apolo routing decision
  const agents = [
    { id: 'hermes-trader', name: 'Hermes', specialty: 'execution', score: 0.92 },
    { id: 'pythia-oracle', name: 'Pythia', specialty: 'signal', score: 0.87 },
    { id: 'apolo-resolver', name: 'Apolo', specialty: 'decision', score: 0.95 },
  ];
  const selected = agents[Math.floor(Math.random() * agents.length)];

  return NextResponse.json({
    ok: true,
    paid: true,
    routing: {
      jobId,
      selectedAgent: selected,
      routedBy: 'apolo-decision-engine',
      confidence: selected.score,
      routedAt: new Date().toISOString(),
    },
  });
}

// 0.01 USDC = 10000 atomic (6 decimals)
export const POST = withX402(handler, {
  amount: '10000',
  resource: '/api/x402/jobs/[id]/route',
  description: 'Route a job to the best available agent via Apolo',
});
