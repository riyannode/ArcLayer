import { NextRequest, NextResponse } from 'next/server';
import {
  createX402Facilitator,
  deriveGatewayPaymentId,
  getBatchFacilitatorClient,
  isBatchPayment,
  recordGatewayPayment,
  parseExactVerifyRequest,
  verifyExactEvmPayment,
} from '@/lib/x402';

export const runtime = 'nodejs';

// ─── Helper: normalize payload for Circle Gateway API ─────────────────────────
// Circle Gateway requires:
//  - network in CAIP-2 format (e.g. "eip155:5042002") not "arcTestnet"
//  - paymentPayload.resource to be present
function toCaip2Network(network: unknown): string {
  if (typeof network !== 'string') return 'eip155:5042002';
  if (network.startsWith('eip155:')) return network;
  if (network === 'arcTestnet') return 'eip155:5042002';
  return network;
}

function normalizeRequirementsForGateway(req: Record<string, unknown>): Record<string, unknown> {
  return { ...req, network: toCaip2Network(req.network) };
}

function normalizePayloadForGateway(payload: Record<string, unknown>, requirements: Record<string, unknown>): Record<string, unknown> {
  const accepted = (payload.accepted as Record<string, unknown> | undefined) ?? requirements;
  const normalizedAccepted = { ...accepted, network: toCaip2Network(accepted.network) };

  // Inject required `resource` field if missing
  let resource = payload.resource as Record<string, unknown> | undefined;
  if (!resource) {
    resource = {
      url: 'https://arclayers.xyz/api/x402-demo/protected',
      description: 'ArcLayer x402 Gateway demo',
      mimeType: 'application/json',
    };
  }

  return { ...payload, accepted: normalizedAccepted, resource };
}

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
    // Check if this is a Gateway batched payment
    const paymentRequirements = body.paymentRequirements as Record<string, unknown> | undefined;
    if (paymentRequirements && isBatchPayment(paymentRequirements)) {
      return handleGatewayVerify(body);
    }
    return handleExactVerify(body);
  }

  // V1 arc-escrow (legacy)
  return handleArcEscrowVerify(req, body);
}

// ─── Gateway batched verify (Circle Gateway) ─────────────────────────────────
async function handleGatewayVerify(body: Record<string, unknown>): Promise<NextResponse> {
  const paymentPayload = body.paymentPayload ?? body;
  const paymentRequirements = body.paymentRequirements as Record<string, unknown>;

  // Circle requires CAIP-2 network format and resource field
  const normalizedRequirements = normalizeRequirementsForGateway(paymentRequirements);
  const normalizedPayload = normalizePayloadForGateway(paymentPayload as Record<string, unknown>, normalizedRequirements);

  try {
    const client = getBatchFacilitatorClient();
    const result = await client.verify(
      normalizedPayload as unknown as Parameters<typeof client.verify>[0],
      normalizedRequirements as unknown as Parameters<typeof client.verify>[1],
    );

    if (!result.isValid) {
      return NextResponse.json(
        { isValid: false, invalidReason: result.invalidReason, payer: result.payer },
        { status: 422 }
      );
    }

    const paymentId = deriveGatewayPaymentId(paymentPayload, paymentRequirements);
    recordGatewayPayment({ paymentId, status: 'verified', payer: result.payer, verifiedAt: Date.now(), raw: result as unknown as Record<string, unknown> });

    return NextResponse.json(
      { isValid: true, payer: result.payer, paymentIdentifier: paymentId, extra: { mode: 'circle-gateway', status: 'verified' } },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gateway verify failed';
    return NextResponse.json(
      { isValid: false, invalidReason: 'gateway_error', invalidMessage: message },
      { status: 502 }
    );
  }
}

// ─── Exact scheme (V2 canonical) ──────────────────────────────────────────────
async function handleExactVerify(body: Record<string, unknown>): Promise<NextResponse> {
  const parsed = parseExactVerifyRequest(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { isValid: false, invalidReason: parsed.reason, invalidMessage: parsed.message },
      { status: parsed.status }
    );
  }

  const result = await verifyExactEvmPayment({
    paymentPayload: parsed.paymentPayload,
    paymentRequirements: parsed.paymentRequirements,
  });

  if (!result.isValid) {
    return NextResponse.json(result, { status: 422 });
  }

  return NextResponse.json(result, { status: 200 });
}

// ─── Arc-escrow scheme (V1 legacy) ───────────────────────────────────────────
async function handleArcEscrowVerify(req: NextRequest, body: Record<string, unknown>): Promise<NextResponse> {
  const facilitator = createX402Facilitator();

  if (body.x402Version !== 1) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNSUPPORTED_VERSION', message: 'Only x402Version 1 is supported for arc-escrow scheme' } },
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
