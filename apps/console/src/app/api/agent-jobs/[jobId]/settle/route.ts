/**
 * POST /api/agent-jobs/[jobId]/settle — Arc native x402 settlement for verified jobs
 *
 * Protected by withX402 middleware.
 * Arc native only — no Circle Gateway.
 * Idempotent via x402_resource_payments.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402/middleware';
import { getAgentJob, markJobSettlementPending, markJobSettled } from '@/lib/agent-jobs/store';

async function handler(req: NextRequest): Promise<NextResponse> {
  // jobId from URL
  const segments = req.nextUrl.pathname.split('/');
  const settleIdx = segments.indexOf('settle');
  const jobId = settleIdx >= 2 ? segments[settleIdx - 1] : null;

  if (!jobId) {
    return NextResponse.json({ ok: false, error: 'invalid_job_id' }, { status: 400 });
  }

  const body = await req.clone().json().catch(() => ({} as Record<string, unknown>));
  const buyerAgentId = typeof body.buyerAgentId === 'string' ? body.buyerAgentId.trim() : null;

  if (!buyerAgentId) {
    return NextResponse.json({ ok: false, error: 'buyerAgentId is required' }, { status: 400 });
  }

  // Load job
  const job = await getAgentJob(jobId);
  if (!job) {
    return NextResponse.json({ ok: false, error: 'job_not_found' }, { status: 404 });
  }

  // Validate: status must be verified or settlement_pending
  if (job.status !== 'verified' && job.status !== 'settlement_pending') {
    return NextResponse.json(
      { ok: false, error: 'invalid_status', message: `Job status is ${job.status}, expected verified or settlement_pending` },
      { status: 400 },
    );
  }

  // Validate: buyerAgentId must match
  if (job.buyer_agent_id !== buyerAgentId) {
    return NextResponse.json(
      { ok: false, error: 'buyer_mismatch', message: `Job buyer is ${job.buyer_agent_id}, but settlement request is from ${buyerAgentId}` },
      { status: 403 },
    );
  }

  // Validate: price > 0
  const priceAtomic = job.price_atomic;
  if (!priceAtomic || priceAtomic === '0') {
    return NextResponse.json(
      { ok: false, error: 'zero_price', message: 'Job price is zero, nothing to settle' },
      { status: 400 },
    );
  }

  // Mark settlement_pending before settlement (useful for UI/audit)
  await markJobSettlementPending({ jobId, buyerAgentId });

  // The x402 middleware will settle on-chain and call onSettled hook.
  // Return the settlement context for middleware to use.
  return NextResponse.json({
    ok: true,
    jobId,
    status: 'settlement_pending',
    buyerAgentId,
    priceAtomic,
  });
}

// Build resource string for x402 idempotency
function getResource(jobId: string): string {
  return `/api/agent-jobs/${jobId}/settle`;
}

// Export with x402 protection — Arc native only, no Circle Gateway
export const POST = (() => {
  // We need to resolve jobId for the options. Use a dynamic approach:
  // The middleware uses opts.resource for 402 and idempotency key.
  // The real handler above extracts jobId from URL.
  // We expose a factory or use the withX402 pattern with a wildcard-like resource.
  // Since resources are per-job, we'll use a templated resource prefix that
  // the middleware can use for 402 generation, and the handler extracts the actual jobId.
  const x402Handler = withX402(handler, {
    amount: process.env.X402_JOB_SETTLEMENT_AMOUNT || '1', // Will be overridden in onSettled
    resource: '/api/agent-jobs/:jobId/settle',
    allowedRails: ['arc-native-eoa'],
    onSettled: async (ctx) => {
      // Extract jobId from the handler's response or resource
      // The actual amount and payTo come from the job record
      // We read the job again to get fresh data
      const resourcePath = ctx.resource;
      const segments = resourcePath.split('/');
      const settleIdx = segments.indexOf('settle');
      const jobId = settleIdx >= 2 ? segments[settleIdx - 1] : null;

      if (!jobId) {
        throw new Error('Could not extract jobId from resource path');
      }

      const job = await getAgentJob(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found during settlement callback`);
      }

      // Verify payment amount matches job price
      // ctx.amount is atomic USDC (6 decimals)

      // Record the settlement
      await markJobSettled({
        jobId,
        buyerAgentId: job.buyer_agent_id,
        paymentId: ctx.paymentId,
        txHash: ctx.transaction ?? '',
        payer: ctx.payer ?? '',
        payTo: ctx.payTo,
      });
    },
  });

  // Return a wrapped version that extracts the actual jobId and uses it
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

    // Validate before x402
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
      return NextResponse.json(
        { ok: false, error: 'buyer_mismatch' },
        { status: 403 },
      );
    }

    const priceAtomic = job.price_atomic;
    if (!priceAtomic || priceAtomic === '0') {
      return NextResponse.json({ ok: false, error: 'zero_price' }, { status: 400 });
    }

    // Mark settlement_pending
    await markJobSettlementPending({ jobId, buyerAgentId });

    // Create middleware with actual job resource and price
    const settleHandler = withX402(
      async (innerReq: NextRequest) => {
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
