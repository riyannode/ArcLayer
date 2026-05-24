/**
 * POST /api/agent-jobs/[jobId]/settle — Arc native x402 settlement for verified jobs
 *
 * Protected by withX402 middleware.
 * Arc native only — no Circle Gateway.
 * Idempotent via x402_resource_payments.
 *
 * Flow:
 *   1. Extract jobId, validate status/price/buyer BEFORE x402 (pure check, no status mutation)
 *   2. withX402 verifies payment → runs handler → settles on-chain
 *   3. Inner handler marks settlement_pending (safe: x402 already verified payment)
 *   4. onSettled marks job settled after consumeNativePayment succeeds
 */

import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402/middleware';
import { getAgentJob, markJobSettlementPending, markJobSettled } from '@/lib/agent-jobs/store';

export const POST = (() => {
  return async function settlePost(req: NextRequest): Promise<NextResponse> {
    const segments = req.nextUrl.pathname.split('/');
    const settleIdx = segments.indexOf('settle');
    const jobId = settleIdx >= 2 ? segments[settleIdx - 1] : null;

    if (!jobId) {
      return NextResponse.json({ ok: false, error: 'invalid_job_id' }, { status: 400 });
    }

    const job = await getAgentJob(jobId);
    if (!job) {
      return NextResponse.json({ ok: false, error: 'job_not_found' }, { status: 404 });
    }

    // Validate status — allow verified or settlement_pending
    if (job.status !== 'verified' && job.status !== 'settlement_pending') {
      return NextResponse.json(
        { ok: false, error: 'invalid_status', message: `Job status is ${job.status}, expected verified or settlement_pending` },
        { status: 400 },
      );
    }

    const body = await req.clone().json().catch(() => ({}));
    const buyerAgentId = typeof body.buyerAgentId === 'string' ? body.buyerAgentId.trim() : null;
    if (!buyerAgentId) {
      return NextResponse.json({ ok: false, error: 'buyerAgentId is required' }, { status: 400 });
    }
    if (job.buyer_agent_id !== buyerAgentId) {
      return NextResponse.json({ ok: false, error: 'buyer_mismatch' }, { status: 403 });
    }

    const priceAtomic = job.price_atomic;
    if (!priceAtomic || priceAtomic === '0') {
      return NextResponse.json({ ok: false, error: 'zero_price' }, { status: 400 });
    }

    // Create middleware with actual job resource and price
    // Inner handler runs AFTER x402 payment verification (safe to mutate status)
    const settleHandler = withX402(
      async (_innerReq: NextRequest) => {
        // x402 proof is verified — safe to mark settlement_pending now
        await markJobSettlementPending({ jobId, buyerAgentId });
        return NextResponse.json({
          ok: true,
          jobId,
          buyerAgentId,
          priceAtomic,
        });
      },
      {
        amount: priceAtomic,
        resource: `/api/agent-jobs/${jobId}/settle`,
        allowedRails: ['arc-native-eoa'],
        onSettled: async (ctx) => {
          await markJobSettled({
            jobId,
            buyerAgentId,
            paymentId: ctx.paymentId,
            txHash: ctx.transaction ?? '',
            payer: ctx.payer ?? '',
            payTo: ctx.payTo,
          });
        },
      },
    );

    return settleHandler(req);
  };
})();
