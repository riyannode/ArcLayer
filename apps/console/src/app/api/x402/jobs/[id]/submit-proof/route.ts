import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

/**
 * POST /api/x402/jobs/[id]/submit-proof — x402-gated work proof submission.
 *
 * Worker agents pay 0.01 USDC to submit proof of completed work.
 */

export const runtime = 'nodejs';

async function handler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const jobId = segments[segments.indexOf('jobs') + 1];

  if (!jobId || jobId === '[id]') {
    return NextResponse.json({ ok: false, error: 'missing_job_id' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { agentId, proofType, proofData, summary } = body;

    if (!agentId || !proofData) {
      return NextResponse.json({ ok: false, error: 'missing_fields', message: 'agentId and proofData required' }, { status: 400 });
    }

    const receiptId = `receipt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return NextResponse.json({
      ok: true,
      paid: true,
      receipt: {
        id: receiptId,
        jobId,
        agentId,
        proofType: proofType || 'generic',
        summary: summary || 'Work completed',
        submittedAt: new Date().toISOString(),
        status: 'pending_verification',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'proof_submission_failed' }, { status: 500 });
  }
}

// 0.01 USDC = 10000 atomic (6 decimals)
export const POST = withX402(handler, {
  amount: '10000',
  resource: '/api/x402/jobs/[id]/submit-proof',
  description: 'Submit work proof for a completed job',
});
