/**
 * x402 Dual-Mode Middleware — Circle Gateway + Arc Native (EIP-3009).
 *
 * Pattern: Matches Circle's `withGateway()` from `circlefin/arc-nanopayments`.
 * Single protected endpoint handles both 402 issuance AND payment verification/settlement.
 *
 * Flow:
 *   1. Request without payment header → 402 + PAYMENT-REQUIRED
 *   2. Request with PAYMENT-SIGNATURE (Gateway) or X-PAYMENT (Native) →
 *      verify → settle → run handler → return content + PAYMENT-RESPONSE
 *
 * Dual-mode: accepts both Circle Gateway batching AND Arc Native EIP-3009.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAddress } from 'viem';
import {
  ARC_TESTNET_CAIP2_NETWORK,
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_NETWORK_NAME,
  USDC_ADDRESS,
  X402_VERSION_V2,
} from './constants';
import {
  getBatchFacilitatorClient,
  getArcTestnetGatewayConfig,
  isBatchPayment,
  isGatewayEnabled,
} from './gateway/batch-client';
import {
  deriveGatewayPaymentId,
  recordGatewayPayment,
  consumeGatewayPayment,
} from './gateway/payment-store';
import {
  claimNativePayment,
  consumeNativePayment,
  deriveNativePaymentId,
  markNativeSettled,
  markNativeFailed,
} from './exact/native-payment-store';
import { settleExactPayment } from './exact/settle-exact';
import { verifyExactEvmPayment } from './exact/verify-exact';
import { verifyExactSettlementProof } from './exact/verify-settlement-proof';
import { claimAccessSession, completeAccessSession, releaseAccessSession } from './access-session';
import {
  createRailSession,
  validateRailSession,
  consumeRailSession,
  type AllowedRail,
} from './rail-session';
import type { PaymentRequirements, PaymentPayload } from './exact/types';

// ─── Config ──────────────────────────────────────────────────────────────────

export interface X402MiddlewareOptions {
  /** Price in USDC atomic units (6 decimals). e.g. "1" = $0.000001 */
  amount: string;
  /** Receiver address. Falls back to X402_RECEIVER_ADDRESS env. */
  payTo?: `0x${string}`;
  /** Endpoint path for logging/requirements. */
  resource: string;
  /** Max timeout in seconds. Default 300. */
  maxTimeoutSeconds?: number;
  /** Description shown to client. */
  description?: string;
}

const DEFAULT_PAY_TO = '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2';

function resolvePayTo(override?: `0x${string}`): `0x${string}` {
  if (override) return getAddress(override) as `0x${string}`;
  const env = process.env.X402_RECEIVER_ADDRESS || process.env.X402_PAY_TO || DEFAULT_PAY_TO;
  return getAddress(env) as `0x${string}`;
}

// ─── Requirements builders ───────────────────────────────────────────────────

function buildNativeRequirements(opts: X402MiddlewareOptions, railSessionId?: string): PaymentRequirements {
  return {
    scheme: 'exact',
    network: ARC_TESTNET_CAIP2_NETWORK,
    asset: getAddress(USDC_ADDRESS) as `0x${string}`,
    amount: opts.amount,
    payTo: resolvePayTo(opts.payTo),
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 300,
    extra: { name: 'USDC', version: '2', transferMethod: 'eip3009', decimals: 6, symbol: 'USDC', ...(railSessionId ? { railSessionId } : {}) },
  };
}

function buildGatewayRequirements(opts: X402MiddlewareOptions, railSessionId?: string) {
  const gwConfig = getArcTestnetGatewayConfig();
  return {
    scheme: 'exact' as const,
    network: GATEWAY_NETWORK_NAME,
    asset: getAddress(USDC_ADDRESS) as `0x${string}`,
    amount: opts.amount,
    payTo: resolvePayTo(opts.payTo),
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 300,
    extra: {
      name: CIRCLE_BATCHING_NAME,
      version: CIRCLE_BATCHING_VERSION,
      verifyingContract: process.env.X402_GATEWAY_WALLET_ADDRESS || gwConfig.gatewayWallet,
      supportedChain: GATEWAY_NETWORK_NAME,
      transferMethod: 'gateway-batched-eip3009',
      status: 'live',
      ...(railSessionId ? { railSessionId } : {}),
    },
  };
}

// ─── Header helpers ──────────────────────────────────────────────────────────

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

function extractPayment(req: NextRequest): { proof: Record<string, unknown>; mode: 'gateway' | 'native' } | null {
  const gw = req.headers.get('payment-signature');
  if (gw) {
    const decoded = decodePaymentHeader(gw);
    if (decoded && typeof decoded === 'object') return { proof: decoded as Record<string, unknown>, mode: 'gateway' };
  }
  const native = req.headers.get('x-payment');
  if (native) {
    const decoded = decodePaymentHeader(native);
    if (decoded && typeof decoded === 'object') return { proof: decoded as Record<string, unknown>, mode: 'native' };
  }
  return null;
}

// ─── 402 Response ────────────────────────────────────────────────────────────

function resolveRequestedRail(req: NextRequest): { rail: AllowedRail | null; payer: string | null } {
  const railParam = req.nextUrl.searchParams.get('rail');
  const payerParam = req.nextUrl.searchParams.get('payer');
  const rail = railParam === 'arc-native-eoa' || railParam === 'circle-gateway-passkey' ? railParam : null;
  const payer = payerParam && /^0x[a-fA-F0-9]{40}$/.test(payerParam) ? getAddress(payerParam) : null;
  return { rail, payer };
}

function getRailSessionId(proof: Record<string, unknown>): string | null {
  const accepted = proof.accepted as Record<string, unknown> | undefined;
  const extra = accepted?.extra as Record<string, unknown> | undefined;
  const value = extra?.railSessionId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function paymentRequiredResponse(opts: X402MiddlewareOptions, req: NextRequest) {
  const requested = resolveRequestedRail(req);
  const accepts: unknown[] = [];

  if (requested.rail && requested.payer) {
    const session = createRailSession({
      resource: opts.resource,
      payer: requested.payer,
      allowedRail: requested.rail,
      amount: opts.amount,
      ttlMs: (opts.maxTimeoutSeconds ?? 300) * 1000,
    });
    if (requested.rail === 'arc-native-eoa') {
      accepts.push(buildNativeRequirements(opts, session.sessionId));
    } else if (isGatewayEnabled()) {
      accepts.push(buildGatewayRequirements(opts, session.sessionId));
    }
  } else {
    // Backward-compatible dual-mode fallback for generic clients that do not request rail lock.
    accepts.push(buildNativeRequirements(opts));
    if (isGatewayEnabled()) accepts.push(buildGatewayRequirements(opts));
  }

  const paymentRequired = {
    x402Version: X402_VERSION_V2,
    resource: { url: opts.resource, description: opts.description || `Paid resource (${opts.resource})`, mimeType: 'application/json' },
    accepts,
  };

  return new NextResponse(
    JSON.stringify({ ok: false, error: 'payment_required', message: 'x402 payment required', x402Version: X402_VERSION_V2, accepts: paymentRequired.accepts }),
    {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
        'X-402-Version': String(X402_VERSION_V2),
        'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(paymentRequired)).toString('base64'),
      },
    },
  );
}

// ─── Gateway verify + settle (Circle pattern) ────────────────────────────────

async function handleGateway(
  proof: Record<string, unknown>,
  opts: X402MiddlewareOptions,
  handler: (req: NextRequest) => Promise<NextResponse>,
  req: NextRequest,
): Promise<NextResponse> {
  if (!isGatewayEnabled()) {
    return NextResponse.json(
      { ok: false, error: 'gateway_disabled', message: 'Circle Gateway mode is disabled. Use Arc Native (X-PAYMENT header).' },
      { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // ─── Rail session guard ─────────────────────────────────────────────────────
  const railSessionId = getRailSessionId(proof);
  if (railSessionId) {
    const earlyPayer = (() => {
      const pl = proof.payload as Record<string, unknown> | undefined;
      const auth = pl?.authorization as Record<string, unknown> | undefined;
      return (auth?.from as string | undefined) ?? '';
    })();
    const railCheck = validateRailSession({
      sessionId: railSessionId,
      incomingRail: 'circle-gateway-passkey',
      payer: earlyPayer,
      resource: opts.resource,
      amount: opts.amount,
    });
    if (railCheck.ok === false) {
      return NextResponse.json(
        { ok: false, error: railCheck.error, message: railCheck.message },
        { status: 403, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  }

  const requirements = buildGatewayRequirements(opts);
  const facilitator = getBatchFacilitatorClient();

  // Verify
  const verifyResult = await facilitator.verify(proof as unknown as Parameters<typeof facilitator.verify>[0], requirements);
  if (!verifyResult.isValid) {
    return NextResponse.json(
      { ok: false, error: 'payment_verification_failed', reason: verifyResult.invalidReason },
      { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // ─── Access session guard: reject if payer already has active session ───
  const earlyPayer = verifyResult.payer ?? (() => {
    const payload = proof.payload as Record<string, unknown> | undefined;
    const auth = payload?.authorization as Record<string, unknown> | undefined;
    return (auth?.from as string | undefined) ?? null;
  })();
  if (earlyPayer) {
    const sessionClaim = await claimAccessSession(earlyPayer, opts.resource, 'circle-gateway');
    if (!sessionClaim.ok) {
      return NextResponse.json(
        { ok: false, error: 'already_paid', message: 'You already have an active access session for this resource.', expiresAt: sessionClaim.expiresAt },
        { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  }

  // Settle
  const settleResult = await facilitator.settle(proof as unknown as Parameters<typeof facilitator.settle>[0], requirements);
  if (!settleResult.success) {
    console.error(`[x402-gw] Settlement failed: ${opts.resource} — ${settleResult.errorReason}`);
    if (earlyPayer) await releaseAccessSession(earlyPayer, opts.resource, 'circle-gateway');
    return NextResponse.json(
      { ok: false, error: 'payment_settlement_failed', reason: settleResult.errorReason },
      { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // Record in Supabase
  const paymentId = deriveGatewayPaymentId(proof, requirements);
  const payer = settleResult.payer ?? verifyResult.payer ?? 'unknown';
  try {
    await recordGatewayPayment({
      paymentId,
      payer,
      amount: requirements.amount,
      network: requirements.network,
      transaction: settleResult.transaction ?? null,
      resource: opts.resource,
      status: 'settled',
    });
  } catch (e) {
    console.error('[x402-gw] Failed to record payment:', e);
  }

  // Consume (replay protection)
  await consumeGatewayPayment(paymentId);

  // Consume rail session (one-shot)
  if (railSessionId) consumeRailSession(railSessionId);

  // Complete access session with payment details
  if (earlyPayer) await completeAccessSession(earlyPayer, opts.resource, 'circle-gateway', paymentId, settleResult.transaction ?? undefined);

  // Execute handler
  const response = await handler(req);

  // Attach PAYMENT-RESPONSE
  const paymentResponse = {
    success: true,
    mode: 'circle-gateway',
    transaction: settleResult.transaction ?? null,
    network: requirements.network,
    payer,
    amount: requirements.amount,
    paymentId,
  };
  response.headers.set('PAYMENT-RESPONSE', encodePaymentResponse(paymentResponse));
  return response;
}

// ─── Native verify + settle (Arc EIP-3009 pattern) ───────────────────────────

async function handleNative(
  proof: Record<string, unknown>,
  opts: X402MiddlewareOptions,
  handler: (req: NextRequest) => Promise<NextResponse>,
  req: NextRequest,
): Promise<NextResponse> {
  const requirements = buildNativeRequirements(opts);

  // ─── Rail session guard ─────────────────────────────────────────────────────
  const railSessionId = getRailSessionId(proof);
  if (railSessionId) {
    const payload = proof.payload as Record<string, unknown> | undefined;
    const authorization = payload?.authorization as Record<string, unknown> | undefined;
    const earlyPayer = (authorization?.from as string | undefined) ?? '';
    const railCheck = validateRailSession({
      sessionId: railSessionId,
      incomingRail: 'arc-native-eoa',
      payer: earlyPayer,
      resource: opts.resource,
      amount: opts.amount,
    });
    if (railCheck.ok === false) {
      return NextResponse.json(
        { ok: false, error: railCheck.error, message: railCheck.message },
        { status: 403, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  }

  // Validate payload structure
  const payload = proof.payload as Record<string, unknown> | undefined;
  const authorization = payload?.authorization as Record<string, unknown> | undefined;
  if (!payload?.signature || !authorization?.from || !authorization?.to || !authorization?.value || !authorization?.validAfter || !authorization?.validBefore || !authorization?.nonce) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payment_proof', message: 'Payment proof must include payload.signature and full payload.authorization (from, to, value, validAfter, validBefore, nonce).' },
      { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // ─── Pre-settlement resource binding ───────────────────────────────────────
  // EIP-3009 verifies the user signed *a* transfer, but the middleware must prove
  // it is the transfer required by this protected resource before unlocking it.
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = proof as unknown as PaymentPayload;
    const proofNetwork = paymentPayload.accepted?.network ?? requirements.network;
    const proofAsset = getAddress(paymentPayload.accepted?.asset ?? requirements.asset);
    const proofPayTo = getAddress(authorization.to as string);
    const requiredPayTo = getAddress(requirements.payTo);

    if (proofNetwork !== requirements.network) {
      return NextResponse.json(
        { ok: false, error: 'invalid_network', message: `Payment network ${proofNetwork} does not match required ${requirements.network}` },
        { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
    if (proofAsset !== getAddress(requirements.asset)) {
      return NextResponse.json(
        { ok: false, error: 'unsupported_asset', message: 'Payment asset does not match required asset.' },
        { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
    if (proofPayTo !== requiredPayTo) {
      return NextResponse.json(
        { ok: false, error: 'invalid_recipient', message: 'Payment recipient does not match protected resource recipient.' },
        { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
    if (String(authorization.value) !== requirements.amount) {
      return NextResponse.json(
        { ok: false, error: 'invalid_amount', message: `Payment amount ${String(authorization.value)} does not match required ${requirements.amount}` },
        { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }

    const verifyResult = await verifyExactEvmPayment({
      paymentPayload,
      paymentRequirements: requirements,
    });
    if (!verifyResult.isValid) {
      return NextResponse.json(
        { ok: false, error: 'payment_verification_failed', reason: verifyResult.invalidReason, message: verifyResult.invalidMessage },
        { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid Arc Native payment proof.';
    return NextResponse.json(
      { ok: false, error: 'invalid_payment_proof', message },
      { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // ─── VERIFY-FIRST PATTERN: Execute handler BEFORE settlement ──────────────
  // Rationale: If handler fails (DB error, timeout, panic), user should NOT be
  // charged. Settlement is irreversible on-chain. Handler success is the gate.
  //
  // Order: verify (done above) → handler → settle → consume
  // Replay/double-spend protection is enforced by EIP-3009 nonce usage +
  // consumeNativePayment(paymentId). No per-payer time lock: reviewers can run
  // multiple fresh payments with fresh nonces.

  let response: NextResponse;
  try {
    response = await handler(req);
  } catch (handlerErr) {
    const msg = handlerErr instanceof Error ? handlerErr.message : 'Handler execution failed';
    return NextResponse.json(
      { ok: false, error: 'handler_failed', message: msg },
      { status: 500, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // Handler succeeded — check response status (non-2xx = logical failure)
  if (response.status >= 400) {
    return response; // Pass through handler's error response without settling
  }

  // ─── Settle on-chain via relayer (only after handler success) ──────────────
  const settleResult = await settleExactPayment({
    paymentPayload: proof as unknown as PaymentPayload,
    paymentRequirements: requirements,
    selfHosted: true,
  });

  if (!settleResult.success) {
    // If already settled, still allow through (idempotent)
    if (!settleResult.alreadySettled) {
      return NextResponse.json(
        { ok: false, error: 'settlement_failed', reason: settleResult.errorReason, message: settleResult.errorMessage },
        { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  }

  // ─── Derive paymentId and consume (replay protection) ─────────────────────
  const paymentId = deriveNativePaymentId({
    network: requirements.network,
    asset: requirements.asset,
    from: authorization.from as string,
    nonce: authorization.nonce as string,
  });

  const consumed = await consumeNativePayment(paymentId);
  if (consumed.ok === false) {
    const reason = consumed.reason;
    if (reason === 'replayed') {
      return NextResponse.json(
        { ok: false, error: 'payment_replayed', message: 'This payment has already been consumed.', paymentId },
        { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
    // missing/not_settled — settle just succeeded above, so this shouldn't happen
    // but guard anyway
    return NextResponse.json(
      { ok: false, error: 'native_payment_not_consumed', reason, paymentId },
      { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // Consume rail session (one-shot)
  if (railSessionId) consumeRailSession(railSessionId);

  // Attach PAYMENT-RESPONSE
  const paymentResponse = {
    success: true,
    mode: 'arc-native',
    transaction: settleResult.transaction,
    network: requirements.network,
    payer: authorization.from as string,
    amount: requirements.amount,
    paymentId,
  };
  response.headers.set('PAYMENT-RESPONSE', encodePaymentResponse(paymentResponse));
  return response;
}

// ─── Main wrapper ────────────────────────────────────────────────────────────

/**
 * Wrap a Next.js route handler with x402 dual-mode payment gating.
 *
 * Usage:
 *   export const GET = withX402(handler, { amount: '1', resource: '/api/x402/protected-resource' });
 *
 * Supports both:
 *   - Circle Gateway (PAYMENT-SIGNATURE header) — batched settlement via Circle facilitator
 *   - Arc Native (X-PAYMENT header) — direct EIP-3009 transferWithAuthorization via relayer
 */
export function withX402(
  handler: (req: NextRequest) => Promise<NextResponse>,
  opts: X402MiddlewareOptions,
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const extracted = extractPayment(req);

    // No payment → 402
    if (!extracted) {
      console.log(`[x402] 402 Payment Required: ${opts.resource}`);
      return paymentRequiredResponse(opts, req);
    }

    // Route to appropriate handler
    try {
      if (extracted.mode === 'gateway') {
        return await handleGateway(extracted.proof, opts, handler, req);
      }
      return await handleNative(extracted.proof, opts, handler, req);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment processing error';
      console.error(`[x402] Error processing ${extracted.mode} payment for ${opts.resource}:`, message);
      return NextResponse.json(
        { ok: false, error: 'payment_processing_error', message },
        { status: 500, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  };
}

/**
 * Convenience: Circle Gateway only (matches circlefin/arc-nanopayments exactly).
 */
export function withGateway(
  handler: (req: NextRequest) => Promise<NextResponse>,
  price: string,
  resource: string,
) {
  const amount = Math.round(parseFloat(price.replace('$', '')) * 1_000_000).toString();
  return withX402(handler, { amount, resource, description: `Paid resource (${price} USDC)` });
}

/**
 * Convenience: Arc Native only.
 */
export function withNative(
  handler: (req: NextRequest) => Promise<NextResponse>,
  opts: Omit<X402MiddlewareOptions, 'resource'> & { resource?: string },
  resource?: string,
) {
  const resolvedResource = opts.resource || resource || '/api/x402/protected-resource';
  return withX402(handler, { ...opts, resource: resolvedResource });
}
