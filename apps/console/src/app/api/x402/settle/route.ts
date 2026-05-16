import { NextRequest, NextResponse } from 'next/server';
import {
  createX402Facilitator,
  deriveGatewayPaymentId,
  getBatchFacilitatorClient,
  isBatchPayment,
  recordGatewayPayment,
  parseExactVerifyRequest,
  settleExactPayment,
} from '@/lib/x402';

export const runtime = 'nodejs';

// ─── Helper: normalize payload for Circle Gateway API ─────────────────────────
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
  const rawResource = payload.resource;
  let resource: Record<string, unknown>;
  if (typeof rawResource === 'string' && rawResource.length > 0) {
    resource = {
      url: rawResource,
      description: 'ArcLayer x402 Gateway demo',
      mimeType: 'application/json',
    };
  } else if (rawResource && typeof rawResource === 'object') {
    resource = rawResource as Record<string, unknown>;
  } else {
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
    const paymentRequirements = body.paymentRequirements as Record<string, unknown> | undefined;
    if (paymentRequirements && isBatchPayment(paymentRequirements)) {
      return handleGatewaySettle(body);
    }
    return handleExactSettle(body);
  }

  return handleArcEscrowSettle(body);
}

// ─── Gateway batched settle (Circle Gateway) ─────────────────────────────────
async function handleGatewaySettle(body: Record<string, unknown>): Promise<NextResponse> {
  const paymentPayload = body.paymentPayload ?? body;
  const paymentRequirements = body.paymentRequirements as Record<string, unknown>;

  const normalizedRequirements = normalizeRequirementsForGateway(paymentRequirements);
  const normalizedPayload = normalizePayloadForGateway(paymentPayload as Record<string, unknown>, normalizedRequirements);

  try {
    const client = getBatchFacilitatorClient();
    const result = await client.settle(
      normalizedPayload as unknown as Parameters<typeof client.settle>[0],
      normalizedRequirements as unknown as Parameters<typeof client.settle>[1],
    );

    const paymentId = deriveGatewayPaymentId(paymentPayload, paymentRequirements);
    if (!result.success) {
      await recordGatewayPayment({
        paymentId,
        status: 'accepted_pending_settlement',
        payer: result.payer,
        payTo: paymentRequirements.payTo as string | undefined,
        amount: paymentRequirements.maxAmountRequired as string | undefined,
        asset: paymentRequirements.asset as string | undefined,
        transaction: result.transaction || '',
        network: result.network,
        resource: typeof paymentRequirements.resource === 'string'
          ? paymentRequirements.resource
          : (paymentRequirements.resource as { url?: string } | undefined)?.url,
        settledAt: Date.now(),
        raw: result as unknown as Record<string, unknown>,
      });
      return NextResponse.json(
        {
          success: true,
          payer: result.payer,
          transaction: result.transaction || '',
          network: result.network,
          paymentIdentifier: paymentId,
          extra: { mode: 'circle-gateway', status: 'accepted_pending_settlement', settlementError: result.errorReason },
        },
        { status: 202 }
      );
    }

    await recordGatewayPayment({
      paymentId,
      status: 'settled',
      payer: result.payer,
      payTo: paymentRequirements.payTo as string | undefined,
      amount: paymentRequirements.maxAmountRequired as string | undefined,
      asset: paymentRequirements.asset as string | undefined,
      transaction: result.transaction,
      network: result.network,
      resource: typeof paymentRequirements.resource === 'string'
        ? paymentRequirements.resource
        : (paymentRequirements.resource as { url?: string } | undefined)?.url,
      settledAt: Date.now(),
      raw: result as unknown as Record<string, unknown>,
    });
    return NextResponse.json(
      {
        success: true,
        payer: result.payer,
        transaction: result.transaction,
        network: result.network,
        paymentIdentifier: paymentId,
        extra: { mode: 'circle-gateway', status: 'settled' },
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gateway settle failed';
    return NextResponse.json(
      { success: false, errorReason: 'gateway_error', errorMessage: message, transaction: '' },
      { status: 502 }
    );
  }
}

// ─── Exact scheme (V2 canonical) ──────────────────────────────────────────────
async function handleExactSettle(body: Record<string, unknown>): Promise<NextResponse> {
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
