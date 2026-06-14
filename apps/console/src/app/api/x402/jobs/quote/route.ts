import { humanJson } from '@/lib/api/human-json';
import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';
import { getPlatformX402PayTo } from '@/lib/x402/platform-pay-to';

/**
 * POST /api/x402/jobs/quote — x402-gated quote request.
 *
 * External agents pay 0.000001 USDC to request a price quote for a job.
 */

export const runtime = 'nodejs';

async function handler(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { jobDescription, urgency } = body;

    if (!jobDescription) {
      return humanJson(req, { ok: false, error: 'missing_job_description' }, { status: 400 });
    }

    // Simulate quote computation based on complexity
    const basePrice = 0.10;
    const urgencyMultiplier = urgency === 'high' ? 2.0 : urgency === 'medium' ? 1.5 : 1.0;
    const estimatedCost = (basePrice * urgencyMultiplier).toFixed(4);

    return humanJson(req, {
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
    return humanJson(req, { ok: false, error: err?.message || 'quote_failed' }, { status: 500 });
  }
}

// 0.000001 USDC = 1 atomic (6 decimals)
export const POST = withX402(handler, {
  amount: '1',
  payTo: getPlatformX402PayTo(),
  // Platform-owned seller: payTo = ArcLayer platform payout.
  resource: '/api/x402/jobs/quote',
  description: 'Request a price quote for an ArcLayer job',
});
