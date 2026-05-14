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

  const paymentRaw = body.payment as Record<string, unknown> | undefined;
  if (!paymentRaw || typeof paymentRaw !== 'object') {
    return NextResponse.json(
      { ok: false, error: { code: 'MISSING_PAYMENT', message: 'payment object is required' } },
      { status: 400 }
    );
  }

  // Also accept X-PAYMENT header as fallback
  const headerPayment = facilitator.parsePaymentFromRequest(req);
  const payment = headerPayment ?? {
    scheme: 'arc-escrow' as const,
    network: 'arc-testnet' as const,
    chainId: Number(paymentRaw.chainId ?? 5042002),
    txHash: String(paymentRaw.txHash ?? ''),
    requirementId: paymentRaw.requirementId as string | undefined,
    resource: paymentRaw.resource as string | undefined,
    jobId: paymentRaw.jobId != null ? String(paymentRaw.jobId) : undefined,
    payer: paymentRaw.payer as string | undefined,
    metadata: paymentRaw.metadata as Record<string, unknown> | undefined,
  };

  const resource = (paymentRaw.resource as string) ?? (body.resource as string) ?? '';
  const requirementId = (paymentRaw.requirementId as string) ?? (body.requirementId as string) ?? undefined;

  const result = await facilitator.verifyPayment({ payment, resource, requirementId });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, status: 'rejected', error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({
    ok: true,
    status: result.payment.status === 'verified' ? 'verified' : 'replayed',
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
