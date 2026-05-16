import { NextRequest, NextResponse } from 'next/server';
import { createX402Facilitator, parseExactVerifyRequest, settleExactPayment } from '@/lib/x402';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_BODY', message: 'Request body must be valid JSON' } },
      { status: 400 }
    );
  }

  // ─── Scheme routing ───────────────────────────────────────────────────────────
  const scheme = (body.scheme as string) ?? (body.paymentRequirements as Record<string, unknown>)?.scheme ?? null;
  const version = body.x402Version;

  if (version === 2 || scheme === 'exact') {
    return handleExactSettle(body);
  }

  return handleArcEscrowSettle(body);
}

// ─── Exact scheme (V2 canonical) ──────────────────────────────────────────────
async function handleExactSettle(body: Record<string, unknown>): Promise<NextResponse> {
  // Reuse parseExactVerifyRequest for shape validation (settle accepts same structure)
  const parsed = parseExactVerifyRequest(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, errorReason: parsed.reason, errorMessage: parsed.message, transaction: '' },
      { status: parsed.status }
    );
  }

  const selfHosted = body.selfHosted === true || process.env.X402_SETTLE_MODE === 'self-hosted';

  const result = await settleExactPayment({
    paymentPayload: parsed.paymentPayload,
    paymentRequirements: parsed.paymentRequirements,
    selfHosted,
  });

  if (!result.success) {
    return NextResponse.json(result, { status: 422 });
  }

  return NextResponse.json(result, { status: 200 });
}

// ─── Arc-escrow scheme (V1 legacy) ───────────────────────────────────────────
async function handleArcEscrowSettle(body: Record<string, unknown>): Promise<NextResponse> {
  const facilitator = createX402Facilitator();

  if (body.x402Version !== 1) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNSUPPORTED_VERSION', message: 'Only x402Version 1 is supported for arc-escrow scheme' } },
      { status: 400 }
    );
  }

  const paymentId = typeof body.paymentId === 'string' ? body.paymentId : undefined;
  const txHash = typeof body.txHash === 'string' ? body.txHash : undefined;

  if (!paymentId && !txHash) {
    return NextResponse.json(
      { ok: false, status: 'rejected', error: { code: 'MISSING_PAYMENT_REF', message: 'paymentId or txHash is required' } },
      { status: 400 }
    );
  }

  const result = await facilitator.settlePayment({ paymentId, txHash });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, status: 'rejected', error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    status: result.alreadySettled ? 'already_settled' : 'settled',
    payment: {
      paymentId: result.payment.paymentId,
      requirementId: result.payment.requirementId,
      txHash: result.payment.txHash,
      chainId: result.payment.chainId,
      scheme: result.payment.scheme,
      network: result.payment.network,
      payTo: result.payment.payTo,
      asset: result.payment.asset,
      amount: result.payment.amount,
      jobId: result.payment.jobId,
      resource: result.payment.resource,
      eventName: result.payment.eventName,
      status: result.payment.status,
    },
  });
}
