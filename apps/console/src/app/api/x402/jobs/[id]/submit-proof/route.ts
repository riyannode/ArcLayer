import { humanJson } from '@/lib/api/human-json';
import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';
import { getPlatformX402PayTo } from '@/lib/x402/platform-pay-to';

/**
 * POST /api/x402/jobs/[id]/submit-proof — x402-gated work proof submission.
 *
 * Worker agents pay 0.000001 USDC to submit proof of completed work.
 */

export const runtime = 'nodejs';

async function handler(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const jobId = segments[segments.indexOf('jobs') + 1];

  if (!jobId || jobId === '[id]') {
    return humanJson(req, { ok: false, error: 'missing_job_id' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { agentId, proofType, proofData, summary } = body;

    if (!agentId || !proofData) {
      return humanJson(req, { ok: false, error: 'missing_fields', message: 'agentId and proofData required' }, { status: 400 });
    }

    const { createHash } = await import('crypto');
    const receiptId = `receipt_${createHash('sha256').update(JSON.stringify({ jobId, agentId, proofData, ts: Date.now() })).digest('hex').slice(0, 16)}`;

    return humanJson(req, {
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
    return humanJson(req, { ok: false, error: err?.message || 'proof_submission_failed' }, { status: 500 });
  }
}

// 0.000001 USDC = 1 atomic (6 decimals)
export const POST = withX402(handler, {
  amount: '1',
  payTo: getPlatformX402PayTo(),
  // Platform-owned seller: payTo = ArcLayer platform payout.
  resource: '/api/x402/jobs/[id]/submit-proof',
  description: 'Submit work proof for a completed job',
});
