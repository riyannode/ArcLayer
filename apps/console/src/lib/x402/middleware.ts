/**
 * x402 Dual-Mode Middleware — Circle Gateway + Arc Native (EIP-3009).
 *
 * Pattern: Matches Circle's `withGateway()` from `circlefin/arc-nanopayments`.
 * Single protected endpoint handles both 402 issuance AND payment verification/settlement.
 *
 * Flow:
 *   1. Request without payment header → 402 + PAYMENT-REQUIRED
 *   2. Request with PAYMENT-SIGNATURE (Arc Native x402 V2 or Circle Gateway) or X-PAYMENT (legacy Native) →
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
  isBatchPayment,
  isGatewayEnabled,
} from './gateway/batch-client';
import { getGatewayContractAddressServer } from './gateway/config';
import {
  deriveGatewayPaymentId,
  recordGatewayPayment,
  consumeGatewayPayment,
  claimGatewaySettlement,
} from './gateway/payment-store';
import {
  claimNativePayment,
  consumeNativePayment,
  deriveNativePaymentId,
  getNativePayment,
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
import {
  assertResourcePaymentStoreReady,
  buildResourcePaymentKey,
  claimResourcePayment,
  getResourcePayment,
  markResourcePaymentSettled,
  markResourcePaymentFailed,
} from './resource-payment-store';
import type { PaymentRequirements, PaymentPayload } from './exact/types';
import {
  resolveRequiredAgentX402Payer,
  assertX402PayerMatches,
  type AgentX402Rail,
  type AgentX402Scope,
} from './agent-payer';
import { recordAgentX402Ledger } from './agent-ledger';

// ─── Config ──────────────────────────────────────────────────────────────────

export interface X402MiddlewareOptions {
  /** Price in USDC atomic units (6 decimals). e.g. "1" = $0.000001 */
  amount: string;
  /** Receiver address. Falls back to X402_RECEIVER_ADDRESS env unless requireExplicitPayTo is true. */
  payTo?: `0x${string}`;
  /** Require service-owned routes to pass a dynamic payout address; never use global receiver fallback. */
  requireExplicitPayTo?: boolean;
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
  /**
   * Optional post-settlement hook for agent job settlement.
   * Called after markResourcePaymentSettled succeeds.
   * If onSettled throws, returns 502 job_settlement_record_failed.
   * NOT called for replayed/missing consumeNativePayment.
   */
  onSettled?: (ctx: {
    req: NextRequest;
    response: NextResponse;
    mode: 'arc-native' | 'circle-gateway';
    paymentId: string;
    transaction: string | null;
    payer: string | null;
    payTo: string;
    amount: string;
    resource: string;
  }) => Promise<void>;
  /**
   * Allowed payment rails for this route.
   * Default: both arc-native-eoa and circle-gateway-passkey are allowed.
   * Set to ['arc-native-eoa'] to reject Circle Gateway payments.
   */
  allowedRails?: Array<'arc-native-eoa' | 'circle-gateway-passkey'>;
  /**
   * When true, the native handler requires sessionId/scope/role from the request body.
   * Default: auto-detected from resource path (bridge-access and agent-job-settle require context).
   * Set explicitly true to force context validation on routes that need it.
   * Set explicitly false to skip context validation on routes that don't.
   * Routes with /api/x402/bridge-access or /api/agent-jobs/.../settle always require context.
   */
  requireResourceContext?: boolean;
  /**
   * When true, the generic native path settles payment BEFORE executing the handler.
   * Default: false (handler executes before settlement, verify-first pattern).
   * Only set on routes where handler side effects must NOT run if payment replay is detected.
   * Routes MUST set requireResourceContext: false when using this option.
   */
  settleBeforeHandler?: boolean;
  /**
   * Optional per-agent payer binding for Circle Gateway routes.
   * When `required: true`, the middleware enforces that the actual payer
   * from the Gateway payment proof matches the registered x402 payer
   * for the agent. Rejects before settlement if mismatch or missing.
   * Only use on routes where external agents must pay with their own EOA.
   * Does NOT apply to Arc Native payments (those use a different flow).
   */
  agentPayerBinding?: {
    required: boolean;
    rail: AgentX402Rail;
    scope?: AgentX402Scope;
    getContext: (req: NextRequest) => Promise<{
      agentId: string;
      runtimeId?: string | null;
      sessionId?: string | null;
      jobId?: string | null;
    }>;
  };
}

function resolvePayTo(override?: `0x${string}`): `0x${string}` {
  if (override) return getAddress(override) as `0x${string}`;
  const env = [
    process.env.X402_RECEIVER_ADDRESS,
    process.env.X402_PAY_TO,
    process.env.X402_DEFAULT_PAY_TO,
  ].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim();

  if (!env) {
    throw new Error('Missing X402_RECEIVER_ADDRESS, X402_PAY_TO, or X402_DEFAULT_PAY_TO');
  }
  return getAddress(env) as `0x${string}`;
}

function requiresNativeResourceContext(opts: X402MiddlewareOptions): boolean {
  const resource = opts.resource ?? '';
  return (
    opts.requireResourceContext === true ||
    resource.includes('/api/x402/bridge-access') ||
    (resource.includes('/api/agent-jobs/') && resource.includes('/settle'))
  );
}
/** @internal test export — do not use in production */
export const testRequiresNativeResourceContext = requiresNativeResourceContext;


async function emitX402LiveEvent(params: {
  req: NextRequest;
  response?: NextResponse;
  opts: X402MiddlewareOptions;
  mode: 'arc-native' | 'circle-gateway';
  paymentId: string;
  payer?: string | null;
  transaction?: string | null;
  amount: string;
}) {
  const agentId =
    params.opts.liveAgentId ||
    params.response?.headers.get('X-ArcLayer-Agent-Id') ||
    params.req.headers.get('x-arclayer-agent-id');

  if (!agentId) return;

  try {
    const { recordAgentLiveEvent } = await import('@/lib/a2a/live-events');
    await recordAgentLiveEvent({
      agentId,
      agentName: params.opts.liveAgentName ?? params.response?.headers.get('X-ArcLayer-Agent-Name') ?? null,
      eventType: 'x402_paid',
      title: 'x402 paid',
      summary: `x402 ${params.mode} payment settled`,
      txHash: params.transaction ?? null,
      amountAtomic: params.amount,
      currency: 'USDC',
      trace: ['x402_paid'],
      metadata: {
        mode: params.mode,
        paymentId: params.paymentId,
        payer: params.payer ?? null,
        resource: params.opts.resource,
      },
    });
  } catch (err) {
    console.error('[x402] failed to emit live event', err instanceof Error ? err.message : 'unknown');
  }
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
  if (opts.requireExplicitPayTo && !opts.payTo) {
    throw Object.assign(new Error('service_payout_address_missing'), { code: 'service_payout_address_missing' });
  }
  const gatewayContractAddress = getGatewayContractAddressServer();
  return {
    scheme: 'exact' as const,
    network: GATEWAY_NETWORK_NAME,
    asset: getAddress(USDC_ADDRESS) as `0x${string}`,
    amount: opts.amount,
    payTo: opts.payTo ? getAddress(opts.payTo) as `0x${string}` : resolvePayTo(opts.payTo),
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 300,
    extra: {
      name: CIRCLE_BATCHING_NAME,
      version: CIRCLE_BATCHING_VERSION,
      verifyingContract: gatewayContractAddress,
      supportedChain: GATEWAY_NETWORK_NAME,
      transferMethod: 'gateway-batched-eip3009',
      status: 'live',
      ...(railSessionId ? { railSessionId } : {}),
    },
  };
}

export const testBuildGatewayRequirements = buildGatewayRequirements;

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

function extractPayment(req: NextRequest, opts?: X402MiddlewareOptions): { proof: Record<string, unknown>; mode: 'gateway' | 'native' } | null {
  // PAYMENT-SIGNATURE (x402 V2 protocol — used by both Arc Native and Circle Gateway)
  const paySig = req.headers.get('payment-signature');
  if (paySig) {
    const decoded = decodePaymentHeader(paySig);
    if (decoded && typeof decoded === 'object') {
      const proof = decoded as Record<string, unknown>;
      // Classify from payload metadata
      const classified = classifyPaymentFromProof(proof);
      if (classified === 'gateway' || classified === 'native') {
        return { proof, mode: classified };
      }
      // Unclassifiable payload — apply fallback from opts.allowedRails
      if (opts?.allowedRails) {
        if (opts.allowedRails.length === 1) {
          if (opts.allowedRails[0] === 'arc-native-eoa') {
            return { proof, mode: 'native' };
          }
          if (opts.allowedRails[0] === 'circle-gateway-passkey') {
            return { proof, mode: 'gateway' };
          }
        }
      }
      // Absent or allows both rails — no extracted payment
      return null;
    }
  }
  // X-PAYMENT (legacy Arc Native fallback)
  const native = req.headers.get('x-payment');
  if (native) {
    const decoded = decodePaymentHeader(native);
    if (decoded && typeof decoded === 'object') return { proof: decoded as Record<string, unknown>, mode: 'native' };
  }
  return null;
}
/** @internal test export — do not use in production */
export const testExtractPayment = extractPayment;

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

/**
 * Classify a PAYMENT-SIGNATURE payload by inspecting accepted.extra metadata.
 * - transferMethod === "gateway-batched-eip3009" OR name === "GatewayWalletBatched" => gateway
 * - transferMethod === "eip3009" OR name === "USDC" => native
 * - otherwise => null (unclassifiable)
 */
function classifyPaymentFromProof(proof: Record<string, unknown>): 'gateway' | 'native' | null {
  const accepted = proof.accepted as Record<string, unknown> | undefined;
  const extra = accepted?.extra as Record<string, unknown> | undefined;
  if (!extra) return null;

  const transferMethod = typeof extra.transferMethod === 'string' ? extra.transferMethod.toLowerCase() : undefined;
  const name = typeof extra.name === 'string' ? extra.name.toLowerCase() : undefined;

  if (transferMethod === 'gateway-batched-eip3009' || name === 'gatewaywalletbatched') {
    return 'gateway';
  }
  if (transferMethod === 'eip3009' || name === 'usdc') {
    return 'native';
  }
  return null;
}
/** @internal test export — do not use in production */
export const testClassifyPaymentFromProof = classifyPaymentFromProof;

function railAllowed(opts: X402MiddlewareOptions, rail: AllowedRail): boolean {
  return !opts.allowedRails || opts.allowedRails.includes(rail);
}

function paymentRequiredResponse(opts: X402MiddlewareOptions, req: NextRequest) {
  const requested = resolveRequestedRail(req);
  const accepts: unknown[] = [];

  if (requested.rail && requested.payer) {
    if (!railAllowed(opts, requested.rail)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'rail_not_allowed',
          message: `Rail ${requested.rail} is not allowed for this resource.`,
          allowedRails: opts.allowedRails ?? ['arc-native-eoa', 'circle-gateway-passkey'],
        },
        { status: 403, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }

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
    if (railAllowed(opts, 'arc-native-eoa')) {
      accepts.push(buildNativeRequirements(opts));
    }

    if (railAllowed(opts, 'circle-gateway-passkey') && isGatewayEnabled()) {
      accepts.push(buildGatewayRequirements(opts));
    }
  }

  const paymentRequired = {
    x402Version: X402_VERSION_V2,
    resource: {
      url: opts.resource,
      description: opts.description || `Paid resource (${opts.resource})`,
      mimeType: 'application/json',
    },
    accepts,
  };

  return new NextResponse(
    JSON.stringify({
      ok: false,
      error: 'payment_required',
      message: 'x402 payment required',
      x402Version: X402_VERSION_V2,
      accepts: paymentRequired.accepts,
    }),
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
  const paymentId = deriveGatewayPaymentId(proof, requirements);

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
      if (sessionClaim.reason === 'active_session') {
        return NextResponse.json(
          {
            ok: false,
            error: 'already_paid',
            reason: 'active_session',
            message: 'You already have an active access session for this resource.',
            expiresAt: sessionClaim.expiresAt,
          },
          { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }

      console.error(
        '[x402-gw] Access session claim failed for %s: %s',
        String(opts.resource),
        sessionClaim.reason ?? 'unknown',
      );

      return NextResponse.json(
        {
          ok: false,
          error: 'session_store_unavailable',
          reason: sessionClaim.reason ?? 'unknown',
          message: 'x402 access session store is unavailable. Payment was not settled. Retry later.',
        },
        { status: 503, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  }

  // ─── Per-agent payer binding (Circle Gateway only) ──────────────────────
  // Enforce actual payer == registered agent payer BEFORE settlement.
  // If agentPayerBinding.required, reject immediately on mismatch/missing.
  let agentContext: { agentId: string; controllerAddress: string; expectedPayer: string; runtimeId?: string | null; sessionId?: string | null; jobId?: string | null } | null = null;
  if (opts.agentPayerBinding?.required) {
    const actualPayer = earlyPayer ?? verifyResult.payer ?? null;
    try {
      const rawCtx = await opts.agentPayerBinding.getContext(req);
      const expected = await resolveRequiredAgentX402Payer(
        rawCtx.agentId,
        opts.agentPayerBinding.rail,
        opts.agentPayerBinding.scope,
      );
      agentContext = { ...rawCtx, agentId: expected.agentId, controllerAddress: expected.controllerAddress, expectedPayer: expected.payerAddress };
      const matchResult = assertX402PayerMatches({
        actualPayer,
        expectedPayer: expected.payerAddress,
        agentId: expected.agentId,
      });
      if (!matchResult.ok) {
        if (earlyPayer) await releaseAccessSession(earlyPayer, opts.resource, 'circle-gateway');
        return NextResponse.json(
          { ok: false, error: matchResult.error, ...matchResult.detail },
          { status: matchResult.status, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'agent_payer_resolution_failed';
      const msg = err instanceof Error ? err.message : 'Agent payer resolution failed';
      if (earlyPayer) await releaseAccessSession(earlyPayer, opts.resource, 'circle-gateway');
      return NextResponse.json(
        { ok: false, error: code, message: msg },
        { status: code === 'agent_x402_payer_not_configured' ? 403 : 500, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  }

  const claim = await claimGatewaySettlement({
    paymentId,
    payer: earlyPayer ?? verifyResult.payer ?? undefined,
    payTo: requirements.payTo,
    amount: requirements.amount,
    asset: requirements.asset,
    network: requirements.network,
    resource: opts.resource,
    raw: proof,
  });
  if (!claim.acquired) {
    if (earlyPayer) await releaseAccessSession(earlyPayer, opts.resource, 'circle-gateway');
    return NextResponse.json(
      { ok: false, error: `payment_${claim.reason}`, paymentId, message: 'Gateway payment already processed. Do not retry settlement.' },
      { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // Settle
  let settleResult: Awaited<ReturnType<typeof facilitator.settle>>;
  try {
    settleResult = await facilitator.settle(proof as unknown as Parameters<typeof facilitator.settle>[0], requirements);
  } catch (error) {
    await recordGatewayPayment({
      paymentId,
      payer: earlyPayer ?? verifyResult.payer ?? 'unknown',
      amount: requirements.amount,
      network: requirements.network,
      transaction: undefined,
      resource: opts.resource,
      status: 'failed',
    }).catch(() => undefined);
    if (earlyPayer) await releaseAccessSession(earlyPayer, opts.resource, 'circle-gateway');
    throw error;
  }
  if (!settleResult.success) {
    await recordGatewayPayment({
      paymentId,
      payer: settleResult.payer ?? earlyPayer ?? verifyResult.payer ?? 'unknown',
      amount: requirements.amount,
      network: requirements.network,
      transaction: settleResult.transaction ?? undefined,
      resource: opts.resource,
      status: 'failed',
    }).catch(() => undefined);
    console.error(
          '[x402-gw] Settlement failed for %s: %s',
          String(opts.resource),
          settleResult.errorReason,
        );
    if (earlyPayer) await releaseAccessSession(earlyPayer, opts.resource, 'circle-gateway');
    return NextResponse.json(
      { ok: false, error: 'payment_settlement_failed', reason: settleResult.errorReason },
      { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // Record in Supabase
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
      ...(agentContext ? {
        agentId: agentContext.agentId,
        runtimeId: agentContext.runtimeId ?? undefined,
        sessionId: agentContext.sessionId ?? undefined,
        jobId: agentContext.jobId ?? undefined,
        expectedPayer: agentContext.expectedPayer,
        payerVerified: true,
      } : {}),
    });
  } catch (e) {
    console.error('[x402-gw] Failed to record payment:', e);
  }

  // Record in agent ledger (non-blocking, best-effort)
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
    }).catch(() => undefined);
  }

  // Consume (replay protection)
  const consume = await consumeGatewayPayment(paymentId);
  if (!consume.ok) {
    if (earlyPayer) await releaseAccessSession(earlyPayer, opts.resource, 'circle-gateway');
    const status = consume.reason === 'replayed' ? 409 : 502;
    return NextResponse.json(
      { ok: false, error: consume.reason === 'replayed' ? 'payment_replayed' : 'payment_missing_after_settle', paymentId },
      { status, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

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
    ...(agentContext ? {
      agentId: agentContext.agentId,
      runtimeId: agentContext.runtimeId ?? undefined,
      sessionId: agentContext.sessionId ?? undefined,
      jobId: agentContext.jobId ?? undefined,
      expectedPayer: agentContext.expectedPayer,
      payerVerified: true,
    } : {}),
  };
  response.headers.set('PAYMENT-RESPONSE', encodePaymentResponse(paymentResponse));

  // onSettled hook — called AFTER payment is settled on Circle.
  // Settlement is final; receipt recording failure is operational, not financial.
  // We do NOT return 502 here — payer already paid.
  if (opts.onSettled) {
    try {
      await opts.onSettled({
        req,
        response,
        mode: 'circle-gateway',
        paymentId,
        transaction: settleResult.transaction ?? null,
        payer,
        payTo: requirements.payTo,
        amount: requirements.amount,
        resource: opts.resource,
      });
    } catch (settledErr) {
      const msg = settledErr instanceof Error ? settledErr.message : 'onSettled hook failed';

      console.error(
        '[x402-gw] onSettled failed after payment settled for %s paymentId=%s: %s',
        String(opts.resource),
        paymentId,
        msg,
      );

      response.headers.set('X-ArcLayer-Receipt-Warning', 'settlement_record_failed');
      response.headers.set('X-ArcLayer-Receipt-Warning-Reason', msg.slice(0, 200));
    }
  }

  await emitX402LiveEvent({
    req,
    response,
    opts,
    mode: 'circle-gateway',
    paymentId,
    payer,
    transaction: settleResult.transaction ?? null,
    amount: requirements.amount,
  });
  return response;
}

const ALLOWED_RESOURCE_ACTOR_ROLES = new Set([
  'oracle',
  'analyzer',
  'evaluator',
  'executor',
  'buyer',
  'provider',
  'worker',
  'settler',
]);

function normalizeResourceActorRole(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const role = value.trim().toLowerCase();
  return ALLOWED_RESOURCE_ACTOR_ROLES.has(role) ? role : null;
}

// ─── Native verify + settle (Arc EIP-3009 pattern) ───────────────────────────

async function handleNative(
  proof: Record<string, unknown>,
  opts: X402MiddlewareOptions,
  handler: (req: NextRequest) => Promise<NextResponse>,
  req: NextRequest,
): Promise<NextResponse> {
  const requirements = buildNativeRequirements(opts);
  const needsResourceContext = requiresNativeResourceContext(opts);
  const reqBody = needsResourceContext
    ? await req.clone().json().catch(() => ({} as Record<string, unknown>))
    : ({} as Record<string, unknown>);
  const scope = typeof reqBody.scope === 'string' && reqBody.scope.trim().length > 0 ? reqBody.scope.trim() : null;
  const inputSessionId = typeof reqBody.sessionId === 'string' && reqBody.sessionId.trim().length > 0 ? reqBody.sessionId.trim() : null;
  const role = normalizeResourceActorRole(reqBody.role);

  if (needsResourceContext) {
    if (!inputSessionId) {
      return NextResponse.json(
        { ok: false, error: 'invalid_session', message: 'sessionId is required for x402 bridge-access payments.' },
        { status: 400, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
    if (!scope) {
      return NextResponse.json(
        { ok: false, error: 'invalid_scope', message: 'scope is required and must be non-empty for x402 bridge-access payments.' },
        { status: 400, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
    if (!role) {
      return NextResponse.json(
        { ok: false, error: 'invalid_role', message: 'role must be a canonical resource actor role.' },
        { status: 400, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  }

  const resourceRole = role ?? '';

  // ─── Resource payment store readiness guard ─────────────────────────────────
  // Do not settle any bridge-access or agent-job payment if the idempotency
  // table is unreachable.
  if (needsResourceContext && process.env.PROTOCOL_TX_MODE === 'ARC_TESTNET') {
    try {
      await assertResourcePaymentStoreReady();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'x402_resource_payments_unavailable';
      return NextResponse.json(
        { ok: false, error: 'x402_resource_payments_unavailable', message },
        { status: 503, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  }

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

  // ─── GENERIC NATIVE: No resource context required (e.g. /api/x402/protected-resource) ──
  // For routes that do NOT require sessionId/scope/role (non-bridge, non-agent-job),
  // skip the resource payment store entirely and go straight to handler→settle→consume.
  // Payment ID is derived before any handler execution for both modes.
  if (!needsResourceContext) {
    // ─── Derive payment ID before any handler execution ───────────────────
    const paymentId = deriveNativePaymentId({
      network: requirements.network,
      asset: requirements.asset,
      from: authorization.from as string,
      nonce: authorization.nonce as string,
    });

    if (opts.settleBeforeHandler) {
      // ─── SETTLE-BEFORE-HANDLER PATH (manifest, avatar) ────────────────
      // Order: settle → consume → handler → PAYMENT-RESPONSE → live event → onSettled
      let settleResult;
      try {
        settleResult = await settleExactPayment({
          paymentPayload: proof as unknown as PaymentPayload,
          paymentRequirements: requirements,
          selfHosted: true,
        });
      } catch (settleErr) {
        console.error('[x402] generic native settlement failed', {
          errorName: settleErr instanceof Error ? settleErr.name : 'unknown',
          resource: opts.resource,
        });
        return NextResponse.json(
          { ok: false, error: 'settlement_failed', reason: 'settle_exception', message: 'Arc Native settlement failed.' },
          { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }

      if (!settleResult.success && !settleResult.alreadySettled) {
        return NextResponse.json(
          { ok: false, error: 'settlement_failed', reason: settleResult.errorReason, message: settleResult.errorMessage },
          { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }

      const consumed = await consumeNativePayment(paymentId);
      if (consumed.ok === false) {
        const reason = consumed.reason;
        if (reason === 'replayed') {
          return NextResponse.json(
            { ok: false, error: 'payment_replayed', message: 'This payment has already been consumed.', paymentId },
            { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
          );
        }
        if (reason === 'not_settled') {
          return NextResponse.json(
            { ok: false, error: 'payment_not_settled', message: 'Payment is not in settled state after settlement.', paymentId },
            { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
          );
        }
        return NextResponse.json(
          { ok: false, error: 'native_payment_not_consumed', reason, paymentId },
          { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }

      let response: NextResponse;
      try {
        response = await handler(req);
      } catch (handlerErr) {
        return NextResponse.json(
          { ok: false, error: 'handler_failed', message: 'Handler execution failed.' },
          { status: 500, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }

      // Consume rail session (one-shot)
      if (railSessionId) consumeRailSession(railSessionId);

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
      await emitX402LiveEvent({
        req,
        response,
        opts,
        mode: 'arc-native',
        paymentId,
        payer: authorization.from as string,
        transaction: settleResult.transaction ?? null,
        amount: requirements.amount,
      });

      // Call onSettled after PAYMENT-RESPONSE + live event
      if (opts.onSettled) {
        try {
          await opts.onSettled({
            req,
            response,
            mode: 'arc-native',
            paymentId,
            transaction: settleResult.transaction ?? null,
            payer: authorization.from as string,
            payTo: requirements.payTo,
            amount: requirements.amount,
            resource: opts.resource,
          });
        } catch (settledErr) {
          console.error('[x402] onSettled hook failed', { resource: opts.resource, paymentId });
          return NextResponse.json(
            {
              ok: false,
              error: 'job_settlement_record_failed',
              message: 'onSettled hook failed.',
              paymentId,
              transaction: settleResult.transaction ?? null,
            },
            { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
          );
        }
      }

      return response;
    }

    // ─── DEFAULT VERIFY-FIRST PATH ───────────────────────────────────────
    // Pre-handler replay guard using getNativePayment
    try {
      const existing = await getNativePayment(paymentId);
      if (existing) {
        if (existing.consumedAt) {
          return NextResponse.json(
            { ok: false, error: 'payment_replayed', message: 'This payment has already been consumed.', paymentId },
            { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
          );
        }
        if (existing.status === 'pending') {
          return NextResponse.json(
            { ok: false, error: 'native_payment_in_flight', message: 'Payment is already being processed.', paymentId },
            { status: 425, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
          );
        }
      }
    } catch {
      // getNativePayment may throw on DB error; log and continue to let existing handler-before-settle path proceed
      console.error('[x402] getNativePayment guard failed', { resource: opts.resource, paymentId });
    }

    // Execute handler BEFORE settlement (verify-first pattern)
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
    if (response.status >= 400) return response;

    // Settle on-chain via relayer
    let settleResult;
    try {
      settleResult = await settleExactPayment({
        paymentPayload: proof as unknown as PaymentPayload,
        paymentRequirements: requirements,
        selfHosted: true,
      });
    } catch (settleErr) {
      console.error('[x402] generic native settlement failed', {
        errorName: settleErr instanceof Error ? settleErr.name : 'unknown',
        resource: opts.resource,
      });
      return NextResponse.json(
        { ok: false, error: 'settlement_failed', reason: 'settle_exception', message: 'Arc Native settlement failed.' },
        { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }

    if (!settleResult.success && !settleResult.alreadySettled) {
      return NextResponse.json(
        { ok: false, error: 'settlement_failed', reason: settleResult.errorReason, message: settleResult.errorMessage },
        { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }

    const consumed = await consumeNativePayment(paymentId);
    if (consumed.ok === false) {
      const reason = consumed.reason;
      if (reason === 'replayed') {
        return NextResponse.json(
          { ok: false, error: 'payment_replayed', message: 'This payment has already been consumed.', paymentId },
          { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }
      return NextResponse.json(
        { ok: false, error: 'native_payment_not_consumed', reason, paymentId },
        { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }

    // Call onSettled if provided
    if (opts.onSettled) {
      try {
        await opts.onSettled({
          req,
          response,
          mode: 'arc-native',
          paymentId,
          transaction: settleResult.transaction ?? null,
          payer: authorization.from as string,
          payTo: requirements.payTo,
          amount: requirements.amount,
          resource: opts.resource,
        });
      } catch (settledErr) {
        console.error('[x402] onSettled hook failed', { resource: opts.resource, paymentId });
        return NextResponse.json(
          {
            ok: false,
            error: 'job_settlement_record_failed',
            message: 'onSettled hook failed.',
            paymentId,
            transaction: settleResult.transaction ?? null,
          },
          { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }
    }

    // Consume rail session (one-shot)
    if (railSessionId) consumeRailSession(railSessionId);

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
    await emitX402LiveEvent({
      req,
      response,
      opts,
      mode: 'arc-native',
      paymentId,
      payer: authorization.from as string,
      transaction: settleResult.transaction ?? null,
      amount: requirements.amount,
    });
    return response;
  }

  const resourcePaymentKey = buildResourcePaymentKey({
    sessionId: inputSessionId,
    scope,
    role: resourceRole,
    resource: opts.resource,
  });
  const existingResourcePayment = await getResourcePayment(resourcePaymentKey);
  if (existingResourcePayment?.status === 'settled') {
    const paymentResponse = {
      success: true,
      mode: 'arc-native' as const,
      transaction: existingResourcePayment.transaction ?? null,
      network: ARC_TESTNET_CAIP2_NETWORK,
      payer: existingResourcePayment.payer,
      payTo: existingResourcePayment.payTo,
      amount: existingResourcePayment.amount,
      paymentId: existingResourcePayment.paymentId,
    };

    // Call onSettled if provided — idempotent, safe on job settlement retry
    if (opts.onSettled) {
      try {
        await opts.onSettled({
          req,
          response: NextResponse.json(
            {
              ok: true,
              error: 'session_already_paid',
              sessionId: existingResourcePayment.sessionId,
              scope: existingResourcePayment.scope,
              role: existingResourcePayment.role,
              paymentId: existingResourcePayment.paymentId,
              transaction: existingResourcePayment.transaction ?? null,
              payer: existingResourcePayment.payer,
              payTo: existingResourcePayment.payTo,
              amount: existingResourcePayment.amount,
              mode: 'arc-native',
            },
            {
              status: 200,
              headers: {
                'X-402-Version': String(X402_VERSION_V2),
                'PAYMENT-RESPONSE': encodePaymentResponse(paymentResponse),
              },
            },
          ),
          mode: 'arc-native',
          paymentId: existingResourcePayment.paymentId,
          transaction: existingResourcePayment.transaction ?? null,
          payer: existingResourcePayment.payer,
          payTo: existingResourcePayment.payTo,
          amount: existingResourcePayment.amount,
          resource: opts.resource,
        });
      } catch (settledErr) {
        const msg = settledErr instanceof Error ? settledErr.message : 'onSettled hook failed';
        console.error('[x402] onSettled hook failed for %s:', opts.resource, msg);
        return NextResponse.json(
          {
            ok: false,
            error: 'job_settlement_record_failed',
            message: msg,
            paymentId: existingResourcePayment.paymentId,
            transaction: existingResourcePayment.transaction ?? null,
          },
          { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        error: 'session_already_paid',
        sessionId: existingResourcePayment.sessionId,
        scope: existingResourcePayment.scope,
        role: existingResourcePayment.role,
        paymentId: existingResourcePayment.paymentId,
        transaction: existingResourcePayment.transaction ?? null,
        payer: existingResourcePayment.payer,
        payTo: existingResourcePayment.payTo,
        amount: existingResourcePayment.amount,
        mode: 'arc-native',
      },
      {
        status: 200,
        headers: {
          'X-402-Version': String(X402_VERSION_V2),
          'PAYMENT-RESPONSE': encodePaymentResponse(paymentResponse),
        },
      },
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

  const paymentId = deriveNativePaymentId({
    network: requirements.network,
    asset: requirements.asset,
    from: authorization.from as string,
    nonce: authorization.nonce as string,
  });
  const claim = await claimResourcePayment({
    paymentKey: resourcePaymentKey,
    sessionId: inputSessionId,
    scope,
    role: resourceRole,
    payer: String(authorization.from),
    resource: opts.resource,
    payTo: String(requirements.payTo),
    amount: requirements.amount,
    mode: 'arc-native',
    status: 'pending',
    paymentId,
    transaction: null,
  });
  if (claim.kind === 'settled') {
    const paymentResponse = {
      success: true,
      mode: 'arc-native' as const,
      transaction: claim.record.transaction ?? null,
      network: ARC_TESTNET_CAIP2_NETWORK,
      payer: claim.record.payer,
      payTo: claim.record.payTo,
      amount: claim.record.amount,
      paymentId: claim.record.paymentId,
    };

    // Call onSettled if provided — idempotent, safe on job settlement retry
    if (opts.onSettled) {
      try {
        await opts.onSettled({
          req,
          response: NextResponse.json(
            {
              ok: true,
              error: 'session_already_paid',
              sessionId: claim.record.sessionId,
              scope: claim.record.scope,
              role: claim.record.role,
              paymentId: claim.record.paymentId,
              transaction: claim.record.transaction ?? null,
              payer: claim.record.payer,
              payTo: claim.record.payTo,
              amount: claim.record.amount,
              mode: 'arc-native',
            },
            {
              status: 200,
              headers: {
                'X-402-Version': String(X402_VERSION_V2),
                'PAYMENT-RESPONSE': encodePaymentResponse(paymentResponse),
              },
            },
          ),
          mode: 'arc-native',
          paymentId: claim.record.paymentId,
          transaction: claim.record.transaction ?? null,
          payer: claim.record.payer,
          payTo: claim.record.payTo,
          amount: claim.record.amount,
          resource: opts.resource,
        });
      } catch (settledErr) {
        const msg = settledErr instanceof Error ? settledErr.message : 'onSettled hook failed';
        console.error(
          '[x402] onSettled hook failed for %s:',
          String(opts.resource),
          msg,
        );
        return NextResponse.json(
          {
            ok: false,
            error: 'job_settlement_record_failed',
            message: msg,
            paymentId: claim.record.paymentId,
            transaction: claim.record.transaction ?? null,
          },
          { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        error: 'session_already_paid',
        sessionId: claim.record.sessionId,
        scope: claim.record.scope,
        role: claim.record.role,
        paymentId: claim.record.paymentId,
        transaction: claim.record.transaction ?? null,
        payer: claim.record.payer,
        payTo: claim.record.payTo,
        amount: claim.record.amount,
        mode: 'arc-native',
      },
      {
        status: 200,
        headers: {
          'X-402-Version': String(X402_VERSION_V2),
          'PAYMENT-RESPONSE': encodePaymentResponse(paymentResponse),
        },
      },
    );
  }
  if (claim.kind === 'failed') {
    return NextResponse.json(
      {
        ok: false,
        error: 'payment_state_failed',
        message: 'Previous payment attempt for this resource/session/scope/role is in failed state and will not be retried automatically.'
      },
      { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }
  if (claim.kind === 'pending') {
    return NextResponse.json(
      { ok: false, error: 'payment_in_flight', message: 'Payment is already being processed for this resource/session/scope/role.' },
      { status: 409, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // ─── Settle on-chain via relayer (only after handler success) ──────────────
  let settleResult;
  try {
    settleResult = await settleExactPayment({
      paymentPayload: proof as unknown as PaymentPayload,
      paymentRequirements: requirements,
      selfHosted: true,
    });
  } catch (settleErr) {
    const message = settleErr instanceof Error ? settleErr.message : 'unknown_settle_error';
    await markResourcePaymentFailed(resourcePaymentKey, `settle_exception:${message}`);
    return NextResponse.json(
      { ok: false, error: 'settlement_failed', reason: 'settle_exception', message },
      { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  if (!settleResult.success) {
    if (!settleResult.alreadySettled) {
      await markResourcePaymentFailed(resourcePaymentKey, settleResult.errorReason ?? settleResult.errorMessage ?? 'settlement_failed');
      return NextResponse.json(
        { ok: false, error: 'settlement_failed', reason: settleResult.errorReason, message: settleResult.errorMessage },
        { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
  }

  // Settlement succeeded or was already settled on-chain.
  // Mark settled immediately BEFORE consumeNativePayment to ensure the row
  // status reflects on-chain reality regardless of downstream outcomes.
  await markResourcePaymentSettled(resourcePaymentKey, {
    paymentId,
    transaction: settleResult.transaction ?? null,
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
    // but guard anyway. Do NOT mark resource payment failed — settlement already
    // succeeded on-chain and was marked settled.
    return NextResponse.json(
      { ok: false, error: 'native_payment_not_consumed', reason, paymentId },
      { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
    );
  }

  // ─── Call onSettled AFTER consumeNativePayment succeeds ────────────
  // Order: markResourcePaymentSettled → consumeNativePayment → onSettled
  // This ensures job settlement only fires after on-chain consume is confirmed.
  if (opts.onSettled) {
    try {
      await opts.onSettled({
        req,
        response,
        mode: 'arc-native',
        paymentId,
        transaction: settleResult.transaction ?? null,
        payer: authorization.from as string,
        payTo: requirements.payTo,
        amount: requirements.amount,
        resource: opts.resource,
      });
    } catch (settledErr) {
      const msg = settledErr instanceof Error ? settledErr.message : 'onSettled hook failed';
      console.error('[x402] onSettled hook failed for %s: %s', String(opts.resource), msg);
      return NextResponse.json(
        {
          ok: false,
          error: 'job_settlement_record_failed',
          message: msg,
          paymentId,
          transaction: settleResult.transaction ?? null,
        },
        { status: 502, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
      );
    }
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

  const bridgeSessionId = response.headers.get('X-Agent-Bridge-Session-Id');
  if (bridgeSessionId) {
    try {
      const { insertBridgeReceipt } = await import('@/lib/agent-bridge/store');
      await insertBridgeReceipt({
        sessionId: bridgeSessionId,
        receiptType: 'x402_arc_native',
        paymentId,
        transaction: settleResult.transaction ?? null,
        payloadHash: response.headers.get('X-Agent-Bridge-Payload-Hash'),
        metadata: {
          role: resourceRole,
          scope,
          source: 'x402-autopay',
          payer: authorization.from,
          protocolTxMode: 'arc_testnet',
        },
      });
    } catch (err) {
      console.error('[x402] failed to attach agent bridge receipt', err instanceof Error ? err.message : 'unknown');
    }
  }

  response.headers.set('PAYMENT-RESPONSE', encodePaymentResponse(paymentResponse));
  await emitX402LiveEvent({
    req,
    response,
    opts,
    mode: 'arc-native',
    paymentId,
    payer: authorization.from as string,
    transaction: settleResult.transaction ?? null,
    amount: requirements.amount,
  });
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
 *   - Circle Gateway (PAYMENT-SIGNATURE header with gateway-batched-eip3009 metadata) — batched settlement via Circle facilitator
 *   - Arc Native (PAYMENT-SIGNATURE header with eip3009 metadata, or X-PAYMENT legacy header) — direct EIP-3009 transferWithAuthorization via relayer
 */
export function withX402(
  handler: (req: NextRequest) => Promise<NextResponse>,
  opts: X402MiddlewareOptions,
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const extracted = extractPayment(req, opts);

    // No payment → 402
    if (!extracted) {
      console.log('[x402] 402 Payment Required: %s', String(opts.resource));
      return paymentRequiredResponse(opts, req);
    }

    // ─── Allowed rails gate ────────────────────────────────────────────
    if (opts.allowedRails) {
      const incomingMode = extracted.mode === 'gateway' ? 'circle-gateway-passkey' : 'arc-native-eoa';
      if (!opts.allowedRails.includes(incomingMode as 'arc-native-eoa' | 'circle-gateway-passkey')) {
        console.log(
          '[x402] rail %s not allowed for %s, allowed set:',
          incomingMode,
          String(opts.resource),
          opts.allowedRails,
        );
        return NextResponse.json(
          { ok: false, error: 'rail_not_allowed', message: `Payment rail ${incomingMode} is not allowed for this resource. Allowed: ${opts.allowedRails.join(', ')}` },
          { status: 403, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }
    }

    // Route to appropriate handler
    try {
      if (extracted.mode === 'gateway') {
        return await handleGateway(extracted.proof, opts, handler, req);
      }
      return await handleNative(extracted.proof, opts, handler, req);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment processing error';
      console.error(
        '[x402] Error processing %s payment for %s:',
        extracted.mode,
        String(opts.resource),
        message,
      );
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
  return withX402(handler, {
    amount,
    resource,
    description: `Paid resource (${price} USDC)`,
    allowedRails: ['circle-gateway-passkey'],
  });
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
  return withX402(handler, {
    ...opts,
    resource: resolvedResource,
    allowedRails: ['arc-native-eoa'],
  });
}
