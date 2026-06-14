/**
 * x402 Middleware — Circle Gateway nanopayments only.
 *
 * The generic middleware never resolves a global receiver. Callers must pass an
 * explicit seller payout address: platform routes load ARCLAYER_PLATFORM_X402_PAY_TO
 * themselves, while A2A routes resolve seller agent pay_to from the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAddress } from 'viem';
import {
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_NETWORK_NAME,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  USDC_ADDRESS,
  X402_VERSION_V2,
} from './constants';
import { getBatchFacilitatorClient, isGatewayEnabled } from './gateway/batch-client';
import { getGatewayContractAddressServer } from './gateway/config';
import {
  claimGatewaySettlement,
  consumeGatewayPayment,
  deriveGatewayPaymentId,
  recordGatewayPayment,
} from './gateway/payment-store';
import { claimAccessSession, completeAccessSession, releaseAccessSession } from './access-session';
import { consumeRailSession, createRailSession, validateRailSession } from './rail-session';
import { assertX402PayerMatches, resolveRequiredAgentX402Payer, type AgentX402Scope } from './agent-payer';
import { recordAgentX402Ledger } from './agent-ledger';

export type GatewayPaymentRequirements = {
  scheme: 'exact';
  network: typeof GATEWAY_NETWORK_NAME;
  asset: `0x${string}`;
  amount: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  extra: {
    name: typeof CIRCLE_BATCHING_NAME;
    version: typeof CIRCLE_BATCHING_VERSION;
    verifyingContract: `0x${string}`;
    supportedChain: typeof GATEWAY_NETWORK_NAME;
    transferMethod: 'gateway-batched-eip3009';
    status: 'live';
    railSessionId?: string;
  };
};

export interface X402MiddlewareOptions {
  /** Price in USDC atomic units (6 decimals). e.g. "1" = $0.000001 */
  amount: string;
  /** Explicit seller payout address. No env/global fallback is allowed here. */
  payTo: `0x${string}`;
  /** Endpoint path for logging/requirements. */
  resource: string;
  /** Max timeout in seconds. Default 300. */
  maxTimeoutSeconds?: number;
  /** Description shown to client. */
  description?: string;
  /** Optional live UI agent id for payment notifications. */
  liveAgentId?: string;
  /** Optional live UI agent name for payment notifications. */
  liveAgentName?: string;
  onSettled?: (ctx: {
    req: NextRequest;
    response: NextResponse;
    mode: 'circle-gateway';
    paymentId: string;
    transaction: string | null;
    payer: string | null;
    payTo: string;
    amount: string;
    resource: string;
  }) => Promise<void>;
  /** Optional per-agent payer binding for Circle Gateway routes. */
  agentPayerBinding?: {
    required: boolean;
    scope?: AgentX402Scope;
    getContext: (req: NextRequest) => Promise<{
      agentId: string;
      runtimeId?: string | null;
      sessionId?: string | null;
      jobId?: string | null;
      sellerAgentId?: string | null;
      serviceId?: string | null;
      gateKey?: string | null;
    }>;
  };
}

function decodePaymentHeader(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch { return null; }
  }
  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch { return null; }
}

function encodePaymentResponse(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function classifyPaymentFromProof(proof: Record<string, unknown>): 'gateway' | 'native' | null {
  const accepted = proof.accepted as Record<string, unknown> | undefined;
  const extra = accepted?.extra as Record<string, unknown> | undefined;
  if (!extra) return null;
  const transferMethod = typeof extra.transferMethod === 'string' ? extra.transferMethod.toLowerCase() : undefined;
  const name = typeof extra.name === 'string' ? extra.name.toLowerCase() : undefined;
  if (transferMethod === 'gateway-batched-eip3009' || name === 'gatewaywalletbatched') return 'gateway';
  if (transferMethod === 'eip3009' || name === 'usdc') return 'native';
  return null;
}
export const testClassifyPaymentFromProof = classifyPaymentFromProof;

function extractPayment(req: NextRequest): { proof: Record<string, unknown>; unsupportedNative: boolean } | null {
  const paymentSignature = req.headers.get('payment-signature');
  if (paymentSignature) {
    const decoded = decodePaymentHeader(paymentSignature);
    if (decoded && typeof decoded === 'object') {
      const proof = decoded as Record<string, unknown>;
      const rail = classifyPaymentFromProof(proof);
      return { proof, unsupportedNative: rail === 'native' };
    }
  }

  // Legacy Arc Native header is not supported by the Circle Gateway-only runtime.
  if (req.headers.get('x-payment')) {
    return { proof: {}, unsupportedNative: true };
  }

  return null;
}
export const testExtractPayment = extractPayment;

function buildGatewayRequirements(opts: X402MiddlewareOptions, railSessionId?: string): GatewayPaymentRequirements {
  return {
    scheme: 'exact',
    network: GATEWAY_NETWORK_NAME,
    asset: getAddress(USDC_ADDRESS) as `0x${string}`,
    amount: opts.amount,
    payTo: getAddress(opts.payTo) as `0x${string}`,
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 300,
    extra: {
      name: CIRCLE_BATCHING_NAME,
      version: CIRCLE_BATCHING_VERSION,
      verifyingContract: getGatewayContractAddressServer(),
      supportedChain: GATEWAY_NETWORK_NAME,
      transferMethod: 'gateway-batched-eip3009',
      status: 'live',
      ...(railSessionId ? { railSessionId } : {}),
    },
  };
}
export const testBuildGatewayRequirements = buildGatewayRequirements;

function getProofPayer(proof: Record<string, unknown>): string | null {
  const payload = proof.payload as Record<string, unknown> | undefined;
  const authorization = payload?.authorization as Record<string, unknown> | undefined;
  const from = authorization?.from;
  return typeof from === 'string' && from.length > 0 ? from : null;
}

function getRailSessionId(proof: Record<string, unknown>): string | null {
  const accepted = proof.accepted as Record<string, unknown> | undefined;
  const extra = accepted?.extra as Record<string, unknown> | undefined;
  const value = extra?.railSessionId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function paymentRequiredResponse(opts: X402MiddlewareOptions, req: NextRequest) {
  if (!isGatewayEnabled()) {
    return NextResponse.json(
      { ok: false, error: 'gateway_unavailable', message: 'Circle Gateway is unavailable for this resource.' },
      { status: 503, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  const payerParam = req.nextUrl.searchParams.get('payer');
  const payer = payerParam && /^0x[a-fA-F0-9]{40}$/.test(payerParam) ? getAddress(payerParam) : null;
  const session = payer
    ? createRailSession({
        resource: opts.resource,
        payer,
        allowedRail: 'circle-gateway-passkey',
        amount: opts.amount,
        ttlMs: (opts.maxTimeoutSeconds ?? 300) * 1000,
      })
    : null;

  const accepts = [buildGatewayRequirements(opts, session?.sessionId)];
  const paymentRequired = {
    x402Version: X402_VERSION_V2,
    resource: {
      url: opts.resource,
      description: opts.description || `Paid resource (${opts.resource})`,
      mimeType: 'application/json',
    },
    accepts,
  };
  const body = {
    ok: false,
    error: 'payment_required',
    message: 'x402 Circle Gateway payment required',
    x402Version: X402_VERSION_V2,
    accepts,
  };
  const pretty = req.nextUrl.searchParams.get('pretty') === '1'
    || req.nextUrl.searchParams.get('pretty') === 'true'
    || (req.headers.get('accept') || '').includes('text/html');

  return new NextResponse(pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'X-402-Version': String(X402_VERSION_V2),
      [PAYMENT_REQUIRED_HEADER]: Buffer.from(JSON.stringify(paymentRequired)).toString('base64'),
    },
  });
}

async function emitX402LiveEvent(params: {
  req: NextRequest;
  response?: NextResponse;
  opts: X402MiddlewareOptions;
  paymentId: string;
  payer?: string | null;
  transaction?: string | null;
  amount: string;
}) {
  const agentId = params.opts.liveAgentId || params.response?.headers.get('X-ArcLayer-Agent-Id') || params.req.headers.get('x-arclayer-agent-id');
  if (!agentId) return;
  try {
    const { recordAgentLiveEvent } = await import('@/lib/a2a/live-events');
    await recordAgentLiveEvent({
      agentId,
      agentName: params.opts.liveAgentName ?? params.response?.headers.get('X-ArcLayer-Agent-Name') ?? null,
      eventType: 'x402_paid',
      title: 'x402 paid',
      summary: 'x402 circle-gateway payment settled',
      txHash: params.transaction ?? null,
      amountAtomic: params.amount,
      currency: 'USDC',
      trace: ['x402_paid'],
      metadata: { mode: 'circle-gateway', paymentId: params.paymentId, payer: params.payer ?? null, resource: params.opts.resource },
    });
  } catch (err) {
    console.error('[x402] failed to emit live event', err instanceof Error ? err.message : 'unknown');
  }
}

async function handleGateway(
  proof: Record<string, unknown>,
  opts: X402MiddlewareOptions,
  handler: (req: NextRequest) => Promise<NextResponse>,
  req: NextRequest,
): Promise<NextResponse> {
  if (!isGatewayEnabled()) {
    return NextResponse.json(
      { ok: false, error: 'gateway_unavailable', message: 'Circle Gateway is unavailable for this resource.' },
      { status: 503, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  const requirements = buildGatewayRequirements(opts);
  const railSessionId = getRailSessionId(proof);
  const earlyPayer = getProofPayer(proof);
  if (railSessionId) {
    const railCheck = validateRailSession({
      sessionId: railSessionId,
      incomingRail: 'circle-gateway-passkey',
      payer: earlyPayer ?? '',
      resource: opts.resource,
      amount: opts.amount,
    });
    if (!railCheck.ok) {
      return NextResponse.json({ ok: false, error: railCheck.error, message: railCheck.message }, { status: 403, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
    }
  }

  const facilitator = getBatchFacilitatorClient();
  const paymentId = deriveGatewayPaymentId(proof, requirements);
  const verifyResult = await facilitator.verify(proof as unknown as Parameters<typeof facilitator.verify>[0], requirements);
  if (!verifyResult.isValid) {
    return NextResponse.json({ ok: false, error: 'payment_verification_failed', reason: verifyResult.invalidReason }, { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
  }

  const actualPayer = verifyResult.payer ?? earlyPayer;
  if (!actualPayer) {
    return NextResponse.json({ ok: false, error: 'x402_payer_missing', message: 'Payment proof does not contain a payer address.' }, { status: 400, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
  }

  const sessionClaim = await claimAccessSession(actualPayer, opts.resource, 'circle-gateway');
  if (!sessionClaim.ok) {
    if (sessionClaim.reason === 'active_session') {
      return NextResponse.json({ ok: false, error: 'already_paid', reason: 'active_session', message: 'You already have an active access session for this resource.', expiresAt: sessionClaim.expiresAt }, { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
    }
    return NextResponse.json({ ok: false, error: 'session_store_unavailable', reason: sessionClaim.reason ?? 'unknown', message: 'x402 access session store is unavailable. Payment was not settled. Retry later.' }, { status: 503, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
  }

  let agentContext: {
    agentId: string;
    controllerAddress: string;
    expectedPayer: string;
    runtimeId?: string | null;
    sessionId?: string | null;
    jobId?: string | null;
    sellerAgentId?: string | null;
    serviceId?: string | null;
    gateKey?: string | null;
  } | null = null;

  if (opts.agentPayerBinding?.required) {
    try {
      const rawCtx = await opts.agentPayerBinding.getContext(req);
      const expected = await resolveRequiredAgentX402Payer(rawCtx.agentId, 'circle-gateway', opts.agentPayerBinding.scope ?? 'a2a');
      agentContext = { ...rawCtx, agentId: expected.agentId, controllerAddress: expected.controllerAddress, expectedPayer: expected.payerAddress };
      const match = assertX402PayerMatches({ actualPayer, expectedPayer: expected.payerAddress, agentId: expected.agentId });
      if (!match.ok) {
        await releaseAccessSession(actualPayer, opts.resource, 'circle-gateway');
        return NextResponse.json({ ok: false, error: match.error, ...match.detail }, { status: match.status, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
      }
    } catch (err) {
      await releaseAccessSession(actualPayer, opts.resource, 'circle-gateway');
      const code = (err as { code?: string }).code ?? 'agent_payer_resolution_failed';
      return NextResponse.json({ ok: false, error: code, message: err instanceof Error ? err.message : 'Agent payer resolution failed' }, { status: code === 'agent_x402_payer_not_configured' ? 403 : 500, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
    }
  }

  const claim = await claimGatewaySettlement({ paymentId, payer: actualPayer, payTo: requirements.payTo, amount: requirements.amount, asset: requirements.asset, network: requirements.network, resource: opts.resource, raw: proof });
  if (!claim.acquired) {
    await releaseAccessSession(actualPayer, opts.resource, 'circle-gateway');
    return NextResponse.json({ ok: false, error: `payment_${claim.reason}`, paymentId, message: 'Gateway payment already processed. Do not retry settlement.' }, { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
  }

  let settleResult: Awaited<ReturnType<typeof facilitator.settle>>;
  try {
    settleResult = await facilitator.settle(proof as unknown as Parameters<typeof facilitator.settle>[0], requirements);
  } catch (err) {
    await recordGatewayPayment({ paymentId, payer: actualPayer, amount: requirements.amount, network: requirements.network, resource: opts.resource, status: 'failed' }).catch(() => undefined);
    await releaseAccessSession(actualPayer, opts.resource, 'circle-gateway');
    throw err;
  }

  if (!settleResult.success) {
    await recordGatewayPayment({ paymentId, payer: settleResult.payer ?? actualPayer, amount: requirements.amount, network: requirements.network, transaction: settleResult.transaction ?? undefined, resource: opts.resource, status: 'failed' }).catch(() => undefined);
    await releaseAccessSession(actualPayer, opts.resource, 'circle-gateway');
    return NextResponse.json({ ok: false, error: 'payment_settlement_failed', reason: settleResult.errorReason }, { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
  }

  const payer = settleResult.payer ?? actualPayer;
  await recordGatewayPayment({
    paymentId,
    payer,
    payTo: requirements.payTo,
    amount: requirements.amount,
    network: requirements.network,
    transaction: settleResult.transaction ?? null,
    resource: opts.resource,
    status: 'settled',
    ...(agentContext ? { agentId: agentContext.agentId, runtimeId: agentContext.runtimeId ?? undefined, sessionId: agentContext.sessionId ?? undefined, jobId: agentContext.jobId ?? undefined, expectedPayer: agentContext.expectedPayer, payerVerified: true } : {}),
  }).catch((err) => console.error('[x402-gw] Failed to record payment:', err));

  if (agentContext) {
    recordAgentX402Ledger({
      agentId: agentContext.agentId,
      controllerAddress: agentContext.controllerAddress,
      payerAddress: payer,
      expectedPayer: agentContext.expectedPayer,
      runtimeId: agentContext.runtimeId ?? null,
      sessionId: agentContext.sessionId ?? null,
      jobId: agentContext.jobId ?? null,
      resource: opts.resource,
      rail: 'circle-gateway',
      amount: requirements.amount,
      paymentId,
      settlementRef: settleResult.transaction ?? null,
      status: 'settled',
      receipt: {
        buyerAgentId: agentContext.agentId,
        sellerAgentId: agentContext.sellerAgentId ?? null,
        payerAddress: payer,
        payTo: requirements.payTo,
        serviceId: agentContext.serviceId ?? null,
        gateKey: agentContext.gateKey ?? null,
        amountAtomic: requirements.amount,
        paymentId,
        settlementRef: settleResult.transaction ?? null,
        resource: opts.resource,
        rail: 'circle-gateway',
        status: 'settled',
      },
    }).catch(() => undefined);
  }

  const consume = await consumeGatewayPayment(paymentId);
  if (!consume.ok) {
    await releaseAccessSession(actualPayer, opts.resource, 'circle-gateway');
    return NextResponse.json({ ok: false, error: consume.reason === 'replayed' ? 'payment_replayed' : 'payment_missing_after_settle', paymentId }, { status: consume.reason === 'replayed' ? 409 : 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
  }

  if (railSessionId) consumeRailSession(railSessionId);
  await completeAccessSession(actualPayer, opts.resource, 'circle-gateway', paymentId, settleResult.transaction ?? undefined);

  const response = await handler(req);
  const paymentResponse = {
    success: true,
    mode: 'circle-gateway' as const,
    rail: 'circle-gateway' as const,
    transaction: settleResult.transaction ?? null,
    settlementRef: settleResult.transaction ?? null,
    network: requirements.network,
    payer,
    payTo: requirements.payTo,
    amount: requirements.amount,
    amountAtomic: requirements.amount,
    paymentId,
    ...(agentContext ? { buyerAgentId: agentContext.agentId, sellerAgentId: agentContext.sellerAgentId ?? undefined, serviceId: agentContext.serviceId ?? undefined, gateKey: agentContext.gateKey ?? undefined, expectedPayer: agentContext.expectedPayer, payerVerified: true } : {}),
  };
  response.headers.set(PAYMENT_RESPONSE_HEADER, encodePaymentResponse(paymentResponse));

  if (opts.onSettled) {
    try {
      await opts.onSettled({ req, response, mode: 'circle-gateway', paymentId, transaction: settleResult.transaction ?? null, payer, payTo: requirements.payTo, amount: requirements.amount, resource: opts.resource });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'onSettled hook failed';
      console.error('[x402-gw] onSettled failed after payment settled for %s paymentId=%s: %s', String(opts.resource), paymentId, msg);
      response.headers.set('X-ArcLayer-Receipt-Warning', 'settlement_record_failed');
      response.headers.set('X-ArcLayer-Receipt-Warning-Reason', msg.slice(0, 200));
    }
  }

  await emitX402LiveEvent({ req, response, opts, paymentId, payer, transaction: settleResult.transaction ?? null, amount: requirements.amount });
  return response;
}

export function withX402(handler: (req: NextRequest) => Promise<NextResponse>, opts: X402MiddlewareOptions) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const extracted = extractPayment(req);
    if (!extracted) return paymentRequiredResponse(opts, req);
    if (extracted.unsupportedNative) {
      return NextResponse.json({ ok: false, error: 'unsupported_payment_rail', message: 'Arc Native x402 payments are not supported. Use Circle Gateway batched EIP-3009.' }, { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
    }
    try {
      return await handleGateway(extracted.proof, opts, handler, req);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment processing error';
      console.error('[x402] Error processing Circle Gateway payment for %s: %s', String(opts.resource), message);
      return NextResponse.json({ ok: false, error: 'payment_processing_error', message }, { status: 500, headers: { 'X-402-Version': String(X402_VERSION_V2) } });
    }
  };
}

export function withGateway(
  handler: (req: NextRequest) => Promise<NextResponse>,
  price: string,
  resource: string,
  payTo: `0x${string}`,
) {
  const amount = Math.round(parseFloat(price.replace('$', '')) * 1_000_000).toString();
  return withX402(handler, { amount, payTo, resource, description: `Paid resource (${price} USDC)` });
}
