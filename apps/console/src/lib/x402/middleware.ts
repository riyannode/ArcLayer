/**
 * x402 Middleware — Circle Gateway only.
 *
 * Pattern: Matches Circle's `withGateway()` from `circlefin/arc-nanopayments`.
 * Single protected endpoint handles both 402 issuance AND payment verification/settlement.
 *
 * Flow:
 *   1. Request without payment header → 402 + PAYMENT-REQUIRED (Circle Gateway only)
 *   2. Request with PAYMENT-SIGNATURE (Circle Gateway) → verify → settle → run handler → return content + PAYMENT-RESPONSE
 *   3. X-PAYMENT (deprecated Arc Native) → 402 with deprecation error
 *
 * Only Circle Gateway batching is accepted. Arc Native EIP-3009 has been removed.
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

// Gateway batched settlement needs 7 days + buffer (604900 seconds)
const CIRCLE_GATEWAY_TIMEOUT_SECONDS = 604_900;

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
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? CIRCLE_GATEWAY_TIMEOUT_SECONDS,
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

function extractPayment(req: NextRequest, opts?: X402MiddlewareOptions): { proof: Record<string, unknown>; mode: 'gateway' | 'native' | 'deprecated-native' } | null {
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
      // Unclassifiable payload — default to gateway (gateway-only mode)
      if (opts?.allowedRails && opts.allowedRails[0] === 'arc-native-eoa') {
        return { proof, mode: 'native' };
      }
      return { proof, mode: 'gateway' };
    }
  }
  // X-PAYMENT — deprecated Arc Native header
  const native = req.headers.get('x-payment');
  if (native) {
    console.warn('[x402] X-PAYMENT header received — Arc Native x402 has been removed. Returning deprecated error.');
    const decoded = decodePaymentHeader(native);
    if (decoded && typeof decoded === 'object') return { proof: decoded as Record<string, unknown>, mode: 'deprecated-native' };
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
          allowedRails: opts.allowedRails ?? ['circle-gateway-passkey'],
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
      // Arc Native deprecated — emit gateway instead
      if (isGatewayEnabled()) accepts.push(buildGatewayRequirements(opts, session.sessionId));
    } else if (isGatewayEnabled()) {
      accepts.push(buildGatewayRequirements(opts, session.sessionId));
    }
  } else {
    // Gateway-only: only emit Circle Gateway accepts
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

  const body = {
    ok: false,
    error: 'payment_required',
    message: 'x402 payment required',
    x402Version: X402_VERSION_V2,
    accepts: paymentRequired.accepts,
  };

  const wantsPretty = (req.nextUrl?.searchParams?.get('pretty') === '1')
    || (req.nextUrl?.searchParams?.get('pretty') === 'true')
    || ((req.headers.get('accept') || '').includes('text/html'));

  return new NextResponse(
    wantsPretty ? JSON.stringify(body, null, 2) : JSON.stringify(body),
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
      { ok: false, error: 'gateway_disabled', message: 'Circle Gateway mode is disabled. Configure GATEWAY_API_KEY to enable x402 payments.' },
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


// ─── Main wrapper ────────────────────────────────────────────────────────────

/**
 * Wrap a Next.js route handler with x402 Circle Gateway payment gating.
 *
 * Usage:
 *   export const GET = withX402(handler, { amount: '1', resource: '/api/x402/protected-resource' });
 *
 * Circle Gateway only. Arc Native x402 runtime has been removed.
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
      // Arc Native x402 deprecated — return clear error
      if (extracted.mode === 'deprecated-native') {
        return NextResponse.json(
          {
            ok: false,
            error: 'arc_native_x402_deprecated',
            message: 'Arc Native x402 has been removed. Use Circle Gateway PAYMENT-SIGNATURE.',
          },
          { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }
      // Arc Native via PAYMENT-SIGNATURE — also deprecated
      if (extracted.mode === 'native') {
        console.warn('[x402] Arc Native payment detected — returning deprecated error for %s', String(opts.resource));
        return NextResponse.json(
          {
            ok: false,
            error: 'arc_native_x402_deprecated',
            message: 'Arc Native x402 has been removed. Use Circle Gateway PAYMENT-SIGNATURE.',
          },
          { status: 402, headers: { 'X-402-Version': String(X402_VERSION_V2) } },
        );
      }
      return await handleGateway(extracted.proof, opts, handler, req);
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
 * @deprecated Arc Native x402 has been removed. Use withGateway or withX402 with allowedRails: ['circle-gateway-passkey'].
 * Kept temporarily for test compatibility only.
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
