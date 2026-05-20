import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

/**
 * POST /api/x402/jobs/create — x402-gated job creation.
 *
 * External agents pay 0.000001 USDC to submit a new job to the ArcLayer marketplace.
 * Validates job spec, assigns jobId, returns confirmation.
 */

export const runtime = 'nodejs';

async function handler(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { title, description, budget, requester } = body;

    if (!title || !description) {
      return NextResponse.json({ ok: false, error: 'missing_fields', message: 'title and description are required' }, { status: 400 });
    }

    const { createHash } = await import('crypto');
    const jobId = `job_${createHash('sha256').update(JSON.stringify({ title, description, budget, requester, ts: Date.now() })).digest('hex').slice(0, 16)}`;

    return NextResponse.json({
      ok: true,
      paid: true,
      job: {
        id: jobId,
        title,
        description,
        budget: budget || '0.00',
        requester: requester || 'anonymous',
        status: 'open',
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'job_creation_failed' }, { status: 500 });
  }
}

// 0.000001 USDC = 1 atomic (6 decimals)
export const POST = withX402(handler, {
  amount: '1',
  resource: '/api/x402/jobs/create',
  description: 'Create a new job on ArcLayer marketplace',
});
