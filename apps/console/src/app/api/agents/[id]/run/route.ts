import { NextRequest, NextResponse } from 'next/server';
import { getAddress } from 'viem';
import { arcTestnet } from '@arclayer/sdk';
import { runAgent } from '@/lib/agentExecutor';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sanitizeErrorMessage } from '@/lib/sanitize-error';
import { createX402Facilitator } from '@/lib/x402/facilitator';
import {
  ARC_TESTNET_CAIP2_NETWORK,
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_NETWORK_NAME,
  USDC_ADDRESS,
  X402_VERSION_V2,
  consumeGatewayPayment,
  createArcNativeReceipt,
  createGatewayReceipt,
  deriveGatewayPaymentId,
  getArcTestnetGatewayConfig,
  isBatchPayment,
  isGatewayEnabled,
  type X402PaymentReceipt,
} from '@/lib/x402';

export const runtime = 'nodejs';

const X402_FACILITATOR_DISABLED = process.env.X402_FACILITATOR_ENABLED === 'false';
const X402_REQUIRE_SETTLEMENT = process.env.X402_REQUIRE_SETTLEMENT === 'true';
const DEFAULT_AMOUNT_ATOMIC = '1000000'; // 1 USDC, 6 decimals
const DEFAULT_PAY_TO = process.env.X402_RECEIVER_ADDRESS || process.env.X402_PAY_TO || '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2';

// ─── Header parsing ──────────────────────────────────────────────────────────

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

function extractPaymentProof(req: NextRequest): { proof: unknown; header: 'PAYMENT-SIGNATURE' | 'X-PAYMENT' } | null {
  const gatewayRaw = req.headers.get('payment-signature');
  if (gatewayRaw) return { proof: decodePaymentHeader(gatewayRaw), header: 'PAYMENT-SIGNATURE' };
  const arcRaw = req.headers.get('x-payment');
  if (arcRaw) return { proof: decodePaymentHeader(arcRaw), header: 'X-PAYMENT' };
  return null;
}

function isValidAgentRouteId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

// ─── Payment requirements builders ──────────────────────────────────────────

function receiver(): `0x${string}` {
  return getAddress(DEFAULT_PAY_TO) as `0x${string}`;
}

function buildArcNativeRequirements() {
  return {
    scheme: 'exact' as const,
    network: ARC_TESTNET_CAIP2_NETWORK,
    asset: getAddress(USDC_ADDRESS) as `0x${string}`,
    amount: DEFAULT_AMOUNT_ATOMIC,
    payTo: receiver(),
    maxTimeoutSeconds: Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '300'),
    extra: { name: 'USDC', version: '2', transferMethod: 'eip3009', decimals: 6, symbol: 'USDC' },
  };
}

function buildGatewayRequirements() {
  return {
    scheme: 'exact' as const,
    network: GATEWAY_NETWORK_NAME,
    asset: getAddress(USDC_ADDRESS) as `0x${string}`,
    amount: DEFAULT_AMOUNT_ATOMIC,
    payTo: receiver(),
    maxTimeoutSeconds: Number(process.env.X402_REQUIREMENT_TTL_SECONDS || '300'),
    extra: {
      name: CIRCLE_BATCHING_NAME,
      version: CIRCLE_BATCHING_VERSION,
      verifyingContract: process.env.X402_GATEWAY_WALLET_ADDRESS || getArcTestnetGatewayConfig().gatewayWallet,
      supportedChain: GATEWAY_NETWORK_NAME,
      transferMethod: 'gateway-batched-eip3009',
      status: 'live',
    },
  };
}

// ─── 402 response ────────────────────────────────────────────────────────────

function paymentRequiredResponse(resource: string, agentId: string, jobId?: string) {
  const arcNative = buildArcNativeRequirements();
  const gateway = buildGatewayRequirements();
  return NextResponse.json(
    {
      ok: false,
      error: 'payment_required',
      message: 'This resource requires x402 payment. Use X-PAYMENT header for Arc Native or PAYMENT-SIGNATURE for Circle Gateway.',
      x402Version: X402_VERSION_V2,
      resource,
      agentId,
      jobId,
      paymentRequirements: arcNative,
      accepts: [arcNative, ...(isGatewayEnabled() ? [gateway] : [])],
    },
    { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2), 'Content-Type': 'application/json' } },
  );
}

// ─── Gateway payment flow ────────────────────────────────────────────────────

async function handleGatewayPayment(
  proof: Record<string, unknown>,
  resource: string,
): Promise<{ ok: true; receipt: X402PaymentReceipt } | { ok: false; response: NextResponse }> {
  if (!isGatewayEnabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'gateway_mode_disabled', message: 'Circle Gateway mode is not enabled.' },
        { status: 503 },
      ),
    };
  }

  const gatewayRequirements = buildGatewayRequirements();
  const paymentId = deriveGatewayPaymentId(proof, gatewayRequirements);

  // ─── Atomic consume-once: looks up settled record + marks consumed in one RPC. ───
  // Returns 'missing' if payment was never settled for this paymentId,
  // 'replayed' if already consumed, or success with evidence.
  const consumed = await consumeGatewayPayment(paymentId);

  if (!consumed.ok && consumed.reason === 'missing') {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'gateway_payment_not_found', paymentId, message: 'Payment not found or not yet settled.' },
        { status: 402 },
      ),
    };
  }

  if (!consumed.ok && consumed.reason === 'replayed') {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'gateway_payment_replayed', paymentId },
        { status: 409 },
      ),
    };
  }

  if (!consumed.ok || !consumed.evidence) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'gateway_payment_consume_failed', paymentId },
        { status: 500 },
      ),
    };
  }

  const evidence = consumed.evidence;
  const receipt = createGatewayReceipt({
    payer: evidence.payer || '0x0000000000000000000000000000000000000000',
    payTo: gatewayRequirements.payTo,
    amount: gatewayRequirements.amount,
    asset: gatewayRequirements.asset,
    network: gatewayRequirements.network,
    resource,
    paymentId,
    gatewaySettlementId: evidence.transaction || undefined,
    status: evidence.status === 'settled' ? 'settled' : 'accepted_pending_settlement',
    verifiedAt: new Date().toISOString(),
    settledAt: evidence.settledAt ? new Date(evidence.settledAt).toISOString() : new Date().toISOString(),
    raw: evidence.raw || {},
  });

  return { ok: true, receipt };
}

// ─── Arc Native payment flow ─────────────────────────────────────────────────

async function handleArcNativePayment(
  req: NextRequest,
  resource: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; receipt: X402PaymentReceipt } | { ok: false; response: NextResponse }> {
  const facilitator = createX402Facilitator();
  const payment = facilitator.parsePaymentFromRequest(req);

  if (!payment) {
    // Trust only the agentId injected by the route handler (route param), never body.agentId.
    const trustedAgentId = typeof body.agentId === 'string' ? body.agentId : '';
    return {
      ok: false,
      response: paymentRequiredResponse(resource, trustedAgentId, body.jobId as string | undefined),
    };
  }

  const verified = await facilitator.verifyPayment({ payment, resource });
  if (!verified.ok) {
    return { ok: false, response: facilitator.paymentRejected(verified) };
  }

  const settled = await facilitator.settlePayment({ paymentId: verified.payment.paymentId });
  if (!settled.ok) {
    return { ok: false, response: facilitator.paymentRejected(settled) };
  }

  const consumed = await facilitator.consumePayment({
    paymentId: verified.payment.paymentId,
    txHash: verified.payment.txHash,
    requirementId: verified.payment.requirementId,
    resource,
    resourceMethod: 'POST',
  });

  if (consumed.cachedResponse) {
    return { ok: false, response: facilitator.toResponse(consumed.cachedResponse) };
  }
  if (!consumed.ok || !consumed.consumptionId) {
    return {
      ok: false,
      response: facilitator.paymentRejected({
        status: consumed.code === 'ALREADY_CONSUMED' ? 409 : 422,
        error: { code: consumed.code, message: consumed.message },
      }),
    };
  }

  const receipt = createArcNativeReceipt({
    payer: settled.payment.payer || '0x0000000000000000000000000000000000000000',
    payTo: settled.payment.payTo,
    amount: settled.payment.amount,
    asset: settled.payment.asset,
    network: `eip155:${arcTestnet.id}`,
    resource,
    paymentId: settled.payment.paymentId,
    txHash: settled.payment.txHash,
    status: 'settled',
    verifiedAt: new Date().toISOString(),
    settledAt: new Date().toISOString(),
    raw: {
      consumptionId: consumed.consumptionId,
      jobId: settled.payment.jobId,
      requirementId: settled.payment.requirementId,
    },
  });

  return { ok: true, receipt };
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = getClientIp(req);
  const rateLimit = checkRateLimit(ip);

  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded', message: 'Too many requests. Try again later.' },
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

  if (!isValidAgentRouteId(agentId)) {
    return NextResponse.json(
      { error: 'invalid_agent_id', message: 'Agent ID must be 1-64 alphanumeric, dash, or underscore characters.' },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const resource = `/api/agents/${agentId}/run`;

  if (X402_FACILITATOR_DISABLED) {
    return NextResponse.json(
      { error: 'x402_facilitator_disabled', message: 'X402 facilitator is required for this route.' },
      { status: 503 }
    );
  }

  // ─── Route by payment header ─────────────────────────────────────────────
  const extracted = extractPaymentProof(req);

  if (!extracted?.proof) {
    return paymentRequiredResponse(resource, agentId, body.jobId == null ? undefined : String(body.jobId));
  }

  let receipt: X402PaymentReceipt;

  if (extracted.header === 'PAYMENT-SIGNATURE' || isBatchPayment(extracted.proof as Record<string, unknown>)) {
    // Circle Gateway path
    const result = await handleGatewayPayment(extracted.proof as Record<string, unknown>, resource);
    if (!result.ok) return result.response;
    receipt = result.receipt;
  } else {
    // Arc Native path (X-PAYMENT header)
    const result = await handleArcNativePayment(req, resource, { ...body, agentId });
    if (!result.ok) return result.response;
    receipt = result.receipt;
  }

  if (X402_REQUIRE_SETTLEMENT && receipt.provider === 'circle-gateway' && receipt.status !== 'settled') {
    return NextResponse.json(
      {
        ok: false,
        error: 'gateway_settlement_required',
        message: 'Payment verified but final Gateway settlement is still pending. Set X402_REQUIRE_SETTLEMENT=false for demo mode.',
        payment: {
          provider: receipt.provider,
          status: receipt.status,
          chainId: arcTestnet.id,
          txHash: receipt.txHash,
          payer: receipt.payer,
          amount: receipt.amount,
          paymentId: receipt.paymentId,
        },
      },
      { status: 402 },
    );
  }

  // ─── Execute agent ───────────────────────────────────────────────────────
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
      { error: 'input_too_long', message: `Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters (got ${inputStr.length}).` },
      { status: 400 }
    );
  }

  try {
    const result = await runAgent({
      agentId,
      jobId: (receipt.raw as Record<string, unknown>)?.jobId as string | undefined ?? agentId,
      payer: receipt.payer,
      input: inputStr || `(no input provided - agent #${agentId} acknowledges payment)`,
    });

    return NextResponse.json({
      ok: true,
      cached: false,
      agentId,
      run: {
        status: 'completed',
        output: result.output,
        model: result.model,
        tokensUsed: result.tokensUsed,
        latencyMs: result.latencyMs,
        completedAt: Date.now(),
      },
      payment: {
        provider: receipt.provider,
        status: receipt.status,
        chainId: arcTestnet.id,
        txHash: receipt.txHash,
        payer: receipt.payer,
        amount: receipt.amount,
        paymentId: receipt.paymentId,
        ...(receipt.provider === 'circle-gateway' && receipt.status === 'accepted_pending_settlement'
          ? { note: 'Live verification; final settlement requires buyer GatewayWallet deposit.' }
          : {}),
      },
    });
  } catch (err) {
    const msg = sanitizeErrorMessage(err);
    return NextResponse.json(
      {
        ok: false,
        cached: false,
        agentId,
        run: { status: 'failed', error: msg, completedAt: Date.now() },
        payment: {
          provider: receipt.provider,
          status: receipt.status,
          chainId: arcTestnet.id,
          txHash: receipt.txHash,
          payer: receipt.payer,
          amount: receipt.amount,
          paymentId: receipt.paymentId,
        },
      },
      { status: 502 }
    );
  }
}
