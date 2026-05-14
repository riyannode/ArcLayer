import { NextRequest, NextResponse } from 'next/server';
import { CONTRACTS, arcTestnet } from '@arclayer/sdk';
import { runAgent } from '@/lib/agentExecutor';
import { createX402Facilitator } from '@/lib/x402/facilitator';

const X402_FACILITATOR_DISABLED = process.env.X402_FACILITATOR_ENABLED === 'false';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const agentId = params.id;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const resource = `/api/agents/${agentId}/run`;

  if (X402_FACILITATOR_DISABLED) {
    return NextResponse.json(
      {
        error: 'x402_facilitator_disabled',
        message: 'X402 facilitator is required for this route.',
      },
      { status: 503 }
    );
  }

  const facilitator = createX402Facilitator();
  const payment = facilitator.parsePaymentFromRequest(req);

  if (!payment) {
    return facilitator.paymentRequired({
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

  const verified = await facilitator.verifyPayment({ payment, resource });
  if (!verified.ok) return facilitator.paymentRejected(verified);

  const settled = await facilitator.settlePayment({ paymentId: verified.payment.paymentId });
  if (!settled.ok) return facilitator.paymentRejected(settled);

  const consumed = await facilitator.consumePayment({
    paymentId: verified.payment.paymentId,
    txHash: verified.payment.txHash,
    requirementId: verified.payment.requirementId,
    resource,
    resourceMethod: 'POST',
  });
  if (consumed.cachedResponse) return facilitator.toResponse(consumed.cachedResponse);
  if (!consumed.ok || !consumed.consumptionId) {
    return facilitator.paymentRejected({
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

    return facilitator.cacheAndReturn({
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
    return facilitator.cacheAndReturn({
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
