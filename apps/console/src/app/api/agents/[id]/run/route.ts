import { NextRequest, NextResponse } from 'next/server';
import { CONTRACTS, arcTestnet } from '@arclayer/sdk';
import { runAgent } from '@/lib/agentExecutor';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sanitizeErrorMessage } from '@/lib/sanitize-error';
import { createX402Facilitator } from '@/lib/x402/facilitator';

const X402_FACILITATOR_DISABLED = process.env.X402_FACILITATOR_ENABLED === 'false';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(ip);

  if (rateLimit.limited) {
    return NextResponse.json(
      {
        error: 'rate_limit_exceeded',
        message: 'Too many requests. Try again later.',
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))),
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
        },
      }
    );
  }

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

  const MAX_INPUT_LENGTH = 2000;
  if (inputStr.length > MAX_INPUT_LENGTH) {
    return NextResponse.json(
      {
        error: 'input_too_long',
        message: `Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters (got ${inputStr.length}).`,
      },
      { status: 400 }
    );
  }

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
    const msg = sanitizeErrorMessage(err);
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
