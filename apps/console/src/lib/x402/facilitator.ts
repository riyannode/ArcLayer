import { createHash, randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import type { X402Payment, X402Requirement, X402Store, X402CachedResponse } from './types';
import { supabaseStore } from './store.supabase';
import { parsePaymentHeader, validatePaymentPayload, canonicalResource } from './parser';
import { buildPaymentRequiredPayload, buildPaymentRequiredHeader, buildPaymentResponsePayload, buildPaymentResponseHeader } from './headers';
import { issueRequirement, type BuildRequirementInput } from './requirements';
import { verifyArcEscrowPayment } from './verify-arc-escrow';
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  JOB_ESCROW_ADDRESS,
  USDC_ADDRESS,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  DEFAULT_RESPONSE_CACHE_TTL_SECONDS,
} from './constants';

function attemptId(): string {
  return `att_${randomBytes(16).toString('hex')}`;
}

function consumerKey(txHash: string, resource: string): string {
  return createHash('sha256').update(`${txHash}:${resource}`).digest('hex');
}

function cacheKey(paymentId: string, resource: string): string {
  return `x402:${paymentId}:${canonicalResource(resource)}`;
}

function cacheTtlSeconds(): number {
  const fromEnv = Number(process.env.X402_RESPONSE_CACHE_TTL_SECONDS || '');
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_RESPONSE_CACHE_TTL_SECONDS;
}

export interface X402FacilitatorOptions {
  store?: X402Store;
  rpcUrl?: string;
  jobEscrowAddress?: string;
}

export interface ConsumePaymentInput {
  paymentId: string;
  txHash: string;
  requirementId: string;
  resource: string;
  resourceMethod?: string;
  consumerKey?: string;
}

export interface CacheAndReturnInput {
  payment: X402Payment;
  consumptionId: string;
  resource: string;
  statusCode: number;
  responseBody?: unknown;
  bodyText?: string;
  contentType?: string;
  responseHeaders?: Record<string, string>;
}

export function createX402Facilitator(opts: X402FacilitatorOptions = {}) {
  const store: X402Store = opts.store ?? supabaseStore;
  const rpcUrl = opts.rpcUrl ?? process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
  const jobEscrowAddress = opts.jobEscrowAddress ?? JOB_ESCROW_ADDRESS;

  async function paymentRequired(input: BuildRequirementInput): Promise<NextResponse> {
    const start = Date.now();
    const aId = attemptId();
    let requirement: X402Requirement | null = null;
    try {
      requirement = await issueRequirement(input, store);
      await store.recordAttempt({
        attemptId: aId,
        requirementId: requirement.requirementId,
        operation: 'issue_requirement',
        status: 'succeeded',
        durationMs: Date.now() - start,
        responsePayload: { requirementId: requirement.requirementId },
      });
      const payload = buildPaymentRequiredPayload(requirement);
      return NextResponse.json(payload, {
        status: 402,
        headers: {
          'X-402-Version': '1',
          [PAYMENT_REQUIRED_HEADER]: buildPaymentRequiredHeader({ x402Version: 1, accepts: payload.accepts }),
        },
      });
    } catch (error) {
      await store.recordAttempt({
        attemptId: aId,
        operation: 'issue_requirement',
        status: 'failed',
        durationMs: Date.now() - start,
        errorCode: 'ISSUE_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json({ ok: false, error: { code: 'ISSUE_FAILED', message: 'Failed to issue payment requirement' } }, { status: 500 });
    }
  }

  function parsePaymentFromRequest(request: Request): ReturnType<typeof parsePaymentHeader> {
    return parsePaymentHeader(request.headers.get('X-PAYMENT') ?? request.headers.get('x-payment'));
  }

  async function verifyPayment(input: {
    payment: ReturnType<typeof parsePaymentHeader>;
    resource: string;
    requirementId?: string;
  }): Promise<{ ok: true; payment: X402Payment; requirement: X402Requirement } | { ok: false; status: number; error: { code: string; message: string } }> {
    const start = Date.now();
    const aId = attemptId();
    const resource = canonicalResource(input.resource);

    const validated = validatePaymentPayload(input.payment, { resource, requirementId: input.requirementId });
    if (!validated.ok) {
      await store.recordAttempt({ attemptId: aId, operation: 'verify', status: 'rejected', durationMs: Date.now() - start, errorCode: validated.error.code, errorMessage: validated.error.message });
      return { ok: false, status: 422, error: validated.error };
    }

    const payload = validated.payment;

    // Check for existing payment (idempotent verify)
    const existing = await store.getPaymentByTxHash(payload.txHash);
    if (existing) {
      if (existing.resource !== resource) {
        await store.recordAttempt({ attemptId: aId, txHash: payload.txHash, operation: 'verify', status: 'rejected', durationMs: Date.now() - start, errorCode: 'PAYMENT_REPLAY_DIFFERENT_RESOURCE', errorMessage: 'txHash already used for different resource' });
        return { ok: false, status: 409, error: { code: 'PAYMENT_REPLAY_DIFFERENT_RESOURCE', message: 'Payment txHash already used for a different resource' } };
      }
      const req = await store.getRequirement(existing.requirementId);
      if (req) {
        await store.recordAttempt({ attemptId: aId, paymentId: existing.paymentId, txHash: payload.txHash, operation: 'verify', status: 'replayed', durationMs: Date.now() - start });
        return { ok: true, payment: existing, requirement: req };
      }
    }

    // Load requirement
    const reqId = payload.requirementId ?? input.requirementId;
    if (!reqId) {
      await store.recordAttempt({ attemptId: aId, txHash: payload.txHash, operation: 'verify', status: 'rejected', durationMs: Date.now() - start, errorCode: 'MISSING_REQUIREMENT_ID', errorMessage: 'requirementId missing from payment payload' });
      return { ok: false, status: 422, error: { code: 'MISSING_REQUIREMENT_ID', message: 'requirementId is required for verification' } };
    }

    const requirement = await store.getRequirement(reqId);
    if (!requirement) {
      await store.recordAttempt({ attemptId: aId, txHash: payload.txHash, requirementId: reqId, operation: 'verify', status: 'rejected', durationMs: Date.now() - start, errorCode: 'REQUIREMENT_NOT_FOUND', errorMessage: 'Requirement not found' });
      return { ok: false, status: 404, error: { code: 'REQUIREMENT_NOT_FOUND', message: 'Payment requirement not found' } };
    }

    // On-chain verify
    const result = await verifyArcEscrowPayment({ payment: payload, requirement, rpcUrl, jobEscrowAddress });
    if (!result.ok) {
      await store.recordAttempt({ attemptId: aId, txHash: payload.txHash, requirementId: reqId, operation: 'verify', status: 'failed', durationMs: Date.now() - start, errorCode: result.code, errorMessage: result.message });
      const httpStatus = result.code === 'REQUIREMENT_EXPIRED' ? 402 : result.code === 'RPC_ERROR' ? 503 : 422;
      return { ok: false, status: httpStatus, error: { code: result.code, message: result.message } };
    }

    // Persist payment
    const created = await store.createPayment(result.payment);
    await store.recordAttempt({ attemptId: aId, paymentId: created.paymentId, txHash: payload.txHash, requirementId: reqId, operation: 'verify', status: 'succeeded', durationMs: Date.now() - start, responsePayload: { paymentId: created.paymentId } });

    return { ok: true, payment: created, requirement };
  }

  async function settlePayment(input: { paymentId?: string; txHash?: string }): Promise<{ ok: true; payment: X402Payment; alreadySettled: boolean } | { ok: false; status: number; error: { code: string; message: string } }> {
    const start = Date.now();
    const aId = attemptId();

    const payment = input.paymentId
      ? await store.getPaymentById(input.paymentId)
      : input.txHash
        ? await store.getPaymentByTxHash(input.txHash)
        : null;

    if (!payment) {
      await store.recordAttempt({ attemptId: aId, operation: 'settle', status: 'failed', durationMs: Date.now() - start, errorCode: 'PAYMENT_NOT_FOUND', errorMessage: 'Payment not found' });
      return { ok: false, status: 404, error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment not found' } };
    }

    if (payment.status === 'settled' || payment.status === 'consumed') {
      await store.recordAttempt({ attemptId: aId, paymentId: payment.paymentId, operation: 'settle', status: 'replayed', durationMs: Date.now() - start });
      return { ok: true, payment, alreadySettled: true };
    }

    const settled = await store.updatePaymentStatus({ paymentId: payment.paymentId, status: 'settled', settlementPayload: { settledAt: new Date().toISOString() } });
    await store.recordAttempt({ attemptId: aId, paymentId: payment.paymentId, operation: 'settle', status: 'succeeded', durationMs: Date.now() - start });
    return { ok: true, payment: settled, alreadySettled: false };
  }

  async function consumePayment(input: ConsumePaymentInput): Promise<{ ok: boolean; code: string; consumptionId?: string; cachedResponse?: X402CachedResponse; message: string }> {
    const start = Date.now();
    const aId = attemptId();
    const resource = canonicalResource(input.resource);
    const key = input.consumerKey ?? consumerKey(input.txHash, resource);
    const ck = cacheKey(input.paymentId, resource);

    const result = await store.consumePayment({
      paymentId: input.paymentId,
      txHash: input.txHash,
      requirementId: input.requirementId,
      resource,
      resourceMethod: input.resourceMethod ?? 'POST',
      consumerKey: key,
    });

    if (result.code === 'ALREADY_CONSUMED') {
      const cached = await store.getCachedResponse(ck);
      await store.recordAttempt({ attemptId: aId, paymentId: input.paymentId, txHash: input.txHash, requirementId: input.requirementId, operation: 'consume', status: 'replayed', durationMs: Date.now() - start });
      return { ...result, cachedResponse: cached ?? undefined };
    }

    await store.recordAttempt({ attemptId: aId, paymentId: input.paymentId, txHash: input.txHash, requirementId: input.requirementId, operation: 'consume', status: result.ok ? 'succeeded' : 'failed', durationMs: Date.now() - start, errorCode: result.ok ? undefined : result.code, errorMessage: result.ok ? undefined : result.message });
    return result;
  }

  async function cacheAndReturn(input: CacheAndReturnInput): Promise<NextResponse> {
    const resource = canonicalResource(input.resource);
    const ck = cacheKey(input.payment.paymentId, resource);
    const ttl = cacheTtlSeconds();
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    const paymentResponseHeader = buildPaymentResponseHeader(buildPaymentResponsePayload(input.payment));

    const cached: X402CachedResponse = {
      cacheKey: ck,
      paymentId: input.payment.paymentId,
      consumptionId: input.consumptionId,
      requirementId: input.payment.requirementId,
      resource,
      statusCode: input.statusCode,
      responseHeaders: { ...(input.responseHeaders ?? {}), [PAYMENT_RESPONSE_HEADER]: paymentResponseHeader },
      responseBody: input.responseBody,
      bodyText: input.bodyText,
      contentType: input.contentType ?? 'application/json',
      expiresAt,
    };

    await store.putCachedResponse(cached).catch(() => null); // non-fatal

    const body = input.responseBody !== undefined ? JSON.stringify(input.responseBody) : (input.bodyText ?? '');
    return new NextResponse(body, {
      status: input.statusCode,
      headers: {
        'Content-Type': input.contentType ?? 'application/json',
        [PAYMENT_RESPONSE_HEADER]: paymentResponseHeader,
        ...(input.responseHeaders ?? {}),
      },
    });
  }

  function toResponse(cached: X402CachedResponse): NextResponse {
    const body = cached.responseBody !== undefined ? JSON.stringify(cached.responseBody) : (cached.bodyText ?? '');
    return new NextResponse(body, {
      status: cached.statusCode,
      headers: {
        'Content-Type': cached.contentType ?? 'application/json',
        ...cached.responseHeaders,
        'X-X402-Cached': 'true',
      },
    });
  }

  function paymentRejected(error: { status: number; error: { code: string; message: string } }): NextResponse {
    return NextResponse.json({ ok: false, error: error.error }, { status: error.status });
  }

  return {
    paymentRequired,
    parsePaymentFromRequest,
    verifyPayment,
    settlePayment,
    consumePayment,
    cacheAndReturn,
    toResponse,
    paymentRejected,
    store,
  };
}

export type X402Facilitator = ReturnType<typeof createX402Facilitator>;
