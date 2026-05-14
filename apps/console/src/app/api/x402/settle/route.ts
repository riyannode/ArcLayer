import { NextRequest, NextResponse } from 'next/server';
import { createX402Facilitator } from '@/lib/x402';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const facilitator = createX402Facilitator();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_BODY', message: 'Request body must be valid JSON' } },
      { status: 400 }
    );
  }

  if (body.x402Version !== 1) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNSUPPORTED_VERSION', message: 'Only x402Version 1 is supported' } },
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
