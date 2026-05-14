import { NextRequest, NextResponse } from 'next/server';
import { CONTRACTS, arcTestnet } from '@arclayer/sdk';
import { runAgent } from '@/lib/agentExecutor';

const X402_FACILITATOR_ENABLED = process.env.X402_FACILITATOR_ENABLED === 'true';

async function getX402Facilitator() {
  const { createX402Facilitator } = await import('@/lib/x402/facilitator');
  return createX402Facilitator();
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const agentId = params.id;
  const payment = req.headers.get('x-payment');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const resource = `/api/agents/${agentId}/run`;

  if (!X402_FACILITATOR_ENABLED) {
    return NextResponse.json(
      {
        error: 'x402_facilitator_disabled',
        message: 'X402 facilitator is required for this route.',
      },
      { status: 503 }
    );
  }

  const x402Facilitator = await getX402Facilitator();

  if (!payment) {
    return x402Facilitator.paymentRequired({
      resource,
      resourceMethod: 'POST',
      agentId,
      jobId: body.jobId == null ? undefined : String(body.jobId),
      amountRequired: '1000000',
      payTo: CONTRACTS.JOB_ESCROW,
      asset: CONTRACTS.USDC,
      description: 'Fund an ArcLayer escrow run with Arc testnet USDC, then retry with X-PAYMENT.',
      mimeType: 'application/json',
      routePattern: '/api/agents/[id]/run',
    });
  }

  const parsedPayment = x402Facilitator.parsePaymentFromRequest(req);
  const verified = await x402Facilitator.verifyPayment({ payment: parsedPayment, resource });
  if (!verified.ok) return x402Facilitator.paymentRejected(verified);

  const settled = await x402Facilitator.settlePayment({ paymentId: verified.payment.paymentId });
  if (!settled.ok) return x402Facilitator.paymentRejected(settled);

  const consumed = await x402Facilitator.consumePayment({
    paymentId: verified.payment.paymentId,
    txHash: verified.payment.txHash,
    requirementId: verified.payment.requirementId,
    resource,
    resourceMethod: 'POST',
  });
  if (consumed.cachedResponse) return x402Facilitator.toResponse(consumed.cachedResponse);
  if (!consumed.ok || !consumed.consumptionId) {
    return x402Facilitator.paymentRejected({
      status: consumed.code === 'ALREADY_CONSUMED' ? 409 : 422,
      error: { code: consumed.code, message: consumed.message },
    });
  }

  const inputRaw = body.input ?? body.prompt ?? null;
  const inputStr =
    typeof inputRaw === 'string'
      ? inputRaw
      : inputRaw == null
        ? ''
        : JSON.stringify(inputRaw);

  try {
    const result = await runAgent({
      agentId,
      jobId: settled.payment.jobId,
      payer: settled.payment.payer ?? '0x0000000000000000000000000000000000000000',
      input: inputStr || `(no input provided - agent #${agentId} acknowledges payment)`,
    });

    return x402Facilitator.cacheAndReturn({
      payment: settled.payment,
      consumptionId: consumed.consumptionId,
      resource,
      statusCode: 200,
      responseBody: {
        ok: true,
        cached: false,
        agentId,
        jobId: settled.payment.jobId,
        run: {
          status: 'completed',
          output: result.output,
          model: result.model,
          tokensUsed: result.tokensUsed,
          latencyMs: result.latencyMs,
          completedAt: Date.now(),
        },
        payment: {
          chainId: arcTestnet.id,
          txHash: settled.payment.txHash,
          payer: settled.payment.payer,
          amount: settled.payment.amount,
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return x402Facilitator.cacheAndReturn({
      payment: settled.payment,
      consumptionId: consumed.consumptionId,
      resource,
      statusCode: 502,
      responseBody: {
        ok: false,
        cached: false,
        agentId,
        jobId: settled.payment.jobId,
        run: {
          status: 'failed',
          error: msg,
          completedAt: Date.now(),
        },
        payment: {
          chainId: arcTestnet.id,
          txHash: settled.payment.txHash,
          payer: settled.payment.payer,
          amount: settled.payment.amount,
        },
      },
    });
  }
}
