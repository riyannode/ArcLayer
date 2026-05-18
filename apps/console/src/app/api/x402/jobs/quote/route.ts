import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

/**
 * POST /api/x402/jobs/quote — x402-gated quote request.
 *
 * External agents pay 0.01 USDC to request a price quote for a job.
 */

export const runtime = 'nodejs';

async function handler(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { jobDescription, urgency } = body;

    if (!jobDescription) {
      return NextResponse.json({ ok: false, error: 'missing_job_description' }, { status: 400 });
    }

    // Simulate quote computation based on complexity
    const basePrice = 0.10;
    const urgencyMultiplier = urgency === 'high' ? 2.0 : urgency === 'medium' ? 1.5 : 1.0;
    const estimatedCost = (basePrice * urgencyMultiplier).toFixed(4);

    return NextResponse.json({
      ok: true,
      paid: true,
      quote: {
        estimatedCost: `${estimatedCost} USDC`,
        urgency: urgency || 'normal',
        estimatedTime: urgency === 'high' ? '< 5 min' : '< 15 min',
        availableAgents: Math.floor(Math.random() * 5) + 2,
        quotedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'quote_failed' }, { status: 500 });
  }
}

// 0.01 USDC = 10000 atomic (6 decimals)
export const POST = withX402(handler, {
  amount: '10000',
  resource: '/api/x402/jobs/quote',
  description: 'Request a price quote for an ArcLayer job',
});
