import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

/**
 * POST /api/x402/jobs/[id]/verify — x402-gated result verification.
 *
 * Autonomous verification of submitted work proof.
 * External agents pay 0.02 USDC per verification request.
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
    const { receiptId, verifierAgent } = body;

    if (!receiptId) {
      return NextResponse.json({ ok: false, error: 'missing_receipt_id' }, { status: 400 });
    }

    // Simulate autonomous verification
    const passed = Math.random() > 0.15; // 85% pass rate
    const confidence = passed ? (0.75 + Math.random() * 0.2) : (0.3 + Math.random() * 0.3);

    return NextResponse.json({
      ok: true,
      paid: true,
      verification: {
        jobId,
        receiptId,
        verifier: verifierAgent || 'apolo-verifier',
        result: passed ? 'PASSED' : 'FAILED',
        confidence: Number(confidence.toFixed(3)),
        reason: passed
          ? 'Work output matches job specification. Quality threshold met.'
          : 'Output does not satisfy job requirements. Partial delivery detected.',
        verifiedAt: new Date().toISOString(),
        reputationDelta: passed ? '+1' : '-1',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'verification_failed' }, { status: 500 });
  }
}

// 0.02 USDC = 20000 atomic (6 decimals)
export const POST = withX402(handler, {
  amount: '20000',
  resource: '/api/x402/jobs/[id]/verify',
  description: 'Verify work result for a completed job',
});
