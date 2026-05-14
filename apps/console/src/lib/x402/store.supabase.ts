import { supabaseAdmin } from './supabaseClient';
import type {
  X402Store,
  X402Requirement,
  X402Payment,
  X402PaymentStatus,
  X402PaymentAttemptInput,
  X402ConsumeResult,
  X402CachedResponse,
} from './types';

function assert0x(value: string, field: string): `0x${string}` {
  if (!value.startsWith('0x') || value.length < 4) {
    throw new Error(`[x402] store data corruption: ${field} is not a 0x-prefixed hex string (got: ${value.slice(0, 10)}...)`);
  }
  return value as `0x${string}`;
}

// snake_case row types

interface ReqRow {
  id: string;
  requirement_id: string;
  protocol: string;
  scheme: string;
  network: string;
  chain_id: number;
  resource: string;
  resource_method: string;
  description: string | null;
  mime_type: string | null;
  pay_to: string;
  asset: string;
  amount_required: string;
  amount_display: string | null;
  currency: string;
  max_timeout_seconds: number;
  expires_at: string;
  nonce: string;
  job_id: string | null;
  agent_id: string | null;
  route_pattern: string | null;
  metadata: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
}

interface PayRow {
  id: string;
  payment_id: string;
  requirement_id: string;
  tx_hash: string;
  chain_id: number;
  scheme: string;
  network: string;
  payer: string | null;
  pay_to: string;
  asset: string;
  amount: string;
  job_id: string;
  resource: string;
  block_number: number | null;
  block_hash: string | null;
  log_index: number | null;
  event_name: string;
  verification_payload: Record<string, unknown>;
  settlement_payload: Record<string, unknown>;
  status: string;
  verified_at: string | null;
  settled_at: string | null;
  consumed_at: string | null;
  expires_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
}

interface CacheRow {
  id: string;
  cache_key: string;
  payment_id: string;
  consumption_id: string;
  requirement_id: string;
  resource: string;
  status_code: number;
  response_headers: Record<string, string>;
  response_body: unknown | null;
  body_text: string | null;
  content_type: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

interface ConsumeRpcRow {
  ok: boolean;
  code: string;
  consumption_id: string | null;
  existing_payment_id: string | null;
  message: string;
}

// mappers

function rowToRequirement(r: ReqRow): X402Requirement {
  return {
    id: r.id,
    requirementId: r.requirement_id,
    protocol: 'x402',
    scheme: r.scheme as X402Requirement['scheme'],
    network: r.network as X402Requirement['network'],
    chainId: r.chain_id,
    resource: r.resource,
    resourceMethod: r.resource_method,
    description: r.description ?? undefined,
    mimeType: r.mime_type ?? undefined,
    payTo: assert0x(r.pay_to, 'requirement.pay_to'),
    asset: assert0x(r.asset, 'requirement.asset'),
    amountRequired: r.amount_required,
    amountDisplay: r.amount_display ?? undefined,
    currency: 'USDC',
    maxTimeoutSeconds: r.max_timeout_seconds,
    expiresAt: r.expires_at,
    nonce: r.nonce,
    jobId: r.job_id ?? undefined,
    agentId: r.agent_id ?? undefined,
    routePattern: r.route_pattern ?? undefined,
    metadata: r.metadata,
    status: r.status as X402Requirement['status'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToPayment(r: PayRow): X402Payment {
  return {
    id: r.id,
    paymentId: r.payment_id,
    requirementId: r.requirement_id,
    txHash: assert0x(r.tx_hash, 'payment.tx_hash'),
    chainId: r.chain_id,
    scheme: r.scheme as X402Payment['scheme'],
    network: r.network as X402Payment['network'],
    payer: r.payer ? assert0x(r.payer, 'payment.payer') : undefined,
    payTo: assert0x(r.pay_to, 'payment.pay_to'),
    asset: assert0x(r.asset, 'payment.asset'),
    amount: r.amount,
    jobId: r.job_id,
    resource: r.resource,
    blockNumber: r.block_number ?? undefined,
    blockHash: r.block_hash ? assert0x(r.block_hash, 'payment.block_hash') : undefined,
    logIndex: r.log_index ?? undefined,
    eventName: 'JobFunded',
    verificationPayload: r.verification_payload,
    settlementPayload: r.settlement_payload,
    status: r.status as X402Payment['status'],
    verifiedAt: r.verified_at ?? undefined,
    settledAt: r.settled_at ?? undefined,
    consumedAt: r.consumed_at ?? undefined,
    expiresAt: r.expires_at ?? undefined,
    failureCode: r.failure_code ?? undefined,
    failureMessage: r.failure_message ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToCache(r: CacheRow): X402CachedResponse {
  return {
    cacheKey: r.cache_key,
    paymentId: r.payment_id,
    consumptionId: r.consumption_id,
    requirementId: r.requirement_id,
    resource: r.resource,
    statusCode: r.status_code,
    responseHeaders: r.response_headers,
    responseBody: r.response_body ?? undefined,
    bodyText: r.body_text ?? undefined,
    contentType: r.content_type ?? undefined,
    expiresAt: r.expires_at,
  };
}

// implementation

export const supabaseStore: X402Store = {
  async createRequirement(req: X402Requirement): Promise<X402Requirement> {
    const { data, error } = await supabaseAdmin
      .from('x402_requirements')
      .insert({
        requirement_id: req.requirementId,
        protocol: req.protocol,
        scheme: req.scheme,
        network: req.network,
        chain_id: req.chainId,
        resource: req.resource,
        resource_method: req.resourceMethod,
        description: req.description ?? null,
        mime_type: req.mimeType ?? null,
        pay_to: req.payTo,
        asset: req.asset,
        amount_required: req.amountRequired,
        amount_display: req.amountDisplay ?? null,
        currency: req.currency,
        max_timeout_seconds: req.maxTimeoutSeconds,
        expires_at: req.expiresAt,
        nonce: req.nonce,
        job_id: req.jobId ?? null,
        agent_id: req.agentId ?? null,
        route_pattern: req.routePattern ?? null,
        metadata: req.metadata,
        status: req.status,
      })
      .select()
      .single();
    if (error) throw new Error(`[x402] createRequirement failed: ${error.message}`);
    return rowToRequirement(data as ReqRow);
  },

  async getRequirement(requirementId: string): Promise<X402Requirement | null> {
    const { data, error } = await supabaseAdmin
      .from('x402_requirements')
      .select()
      .eq('requirement_id', requirementId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`[x402] getRequirement failed: ${error.message}`);
    }
    return rowToRequirement(data as ReqRow);
  },

  async expireRequirement(requirementId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('x402_requirements')
      .update({ status: 'expired' })
      .eq('requirement_id', requirementId);
    if (error) throw new Error(`[x402] expireRequirement failed: ${error.message}`);
  },

  async markRequirementFulfilled(requirementId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('x402_requirements')
      .update({ status: 'fulfilled' })
      .eq('requirement_id', requirementId);
    if (error) throw new Error(`[x402] markRequirementFulfilled failed: ${error.message}`);
  },

  async createPayment(payment: X402Payment): Promise<X402Payment> {
    const { data, error } = await supabaseAdmin
      .from('x402_payments')
      .insert({
        payment_id: payment.paymentId,
        requirement_id: payment.requirementId,
        tx_hash: payment.txHash,
        chain_id: payment.chainId,
        scheme: payment.scheme,
        network: payment.network,
        payer: payment.payer ?? null,
        pay_to: payment.payTo,
        asset: payment.asset,
        amount: payment.amount,
        job_id: payment.jobId,
        resource: payment.resource,
        block_number: payment.blockNumber ?? null,
        block_hash: payment.blockHash ?? null,
        log_index: payment.logIndex ?? null,
        event_name: payment.eventName,
        verification_payload: payment.verificationPayload,
        settlement_payload: payment.settlementPayload,
        status: payment.status,
        verified_at: payment.verifiedAt ?? null,
        expires_at: payment.expiresAt ?? null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        const existing = await this.getPaymentByTxHash(payment.txHash);
        if (
          existing &&
          existing.requirementId === payment.requirementId &&
          existing.resource === payment.resource
        ) {
          return existing;
        }
        throw new Error('[x402] createPayment: txHash already bound to different resource');
      }
      throw new Error(`[x402] createPayment failed: ${error.message}`);
    }
    return rowToPayment(data as PayRow);
  },

  async getPaymentById(paymentId: string): Promise<X402Payment | null> {
    const { data, error } = await supabaseAdmin
      .from('x402_payments')
      .select()
      .eq('payment_id', paymentId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`[x402] getPaymentById failed: ${error.message}`);
    }
    return rowToPayment(data as PayRow);
  },

  async getPaymentByTxHash(txHash: string): Promise<X402Payment | null> {
    const { data, error } = await supabaseAdmin
      .from('x402_payments')
      .select()
      .eq('tx_hash', txHash.toLowerCase())
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`[x402] getPaymentByTxHash failed: ${error.message}`);
    }
    return rowToPayment(data as PayRow);
  },

  async updatePaymentStatus(input: {
    paymentId: string;
    status: X402PaymentStatus;
    settlementPayload?: Record<string, unknown>;
    failureCode?: string;
    failureMessage?: string;
  }): Promise<X402Payment> {
    const patch: Record<string, unknown> = { status: input.status };
    if (input.status === 'settled') patch.settled_at = new Date().toISOString();
    if (input.settlementPayload) patch.settlement_payload = input.settlementPayload;
    if (input.failureCode) patch.failure_code = input.failureCode;
    if (input.failureMessage) patch.failure_message = input.failureMessage;

    const { data, error } = await supabaseAdmin
      .from('x402_payments')
      .update(patch)
      .eq('payment_id', input.paymentId)
      .select()
      .single();
    if (error) throw new Error(`[x402] updatePaymentStatus failed: ${error.message}`);
    return rowToPayment(data as PayRow);
  },

  async recordAttempt(attempt: X402PaymentAttemptInput): Promise<void> {
    try {
      await supabaseAdmin.from('x402_payment_attempts').insert({
        attempt_id: attempt.attemptId,
        payment_id: attempt.paymentId ?? null,
        requirement_id: attempt.requirementId ?? null,
        tx_hash: attempt.txHash ?? null,
        operation: attempt.operation,
        status: attempt.status,
        request_payload: attempt.requestPayload ?? {},
        response_payload: attempt.responsePayload ?? {},
        error_code: attempt.errorCode ?? null,
        error_message: attempt.errorMessage ?? null,
        duration_ms: attempt.durationMs ?? null,
        ip_address: attempt.ipAddress ?? null,
        user_agent: attempt.userAgent ?? null,
      });
    } catch {
      // best-effort: never block the main payment flow
    }
  },

  async consumePayment(input: {
    paymentId: string;
    txHash: string;
    requirementId: string;
    resource: string;
    resourceMethod: string;
    consumerKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<X402ConsumeResult> {
    const { data, error } = await supabaseAdmin.rpc('x402_consume_payment', {
      p_payment_id: input.paymentId,
      p_tx_hash: input.txHash.toLowerCase(),
      p_requirement_id: input.requirementId,
      p_resource: input.resource,
      p_resource_method: input.resourceMethod,
      p_consumer_key: input.consumerKey,
      p_metadata: input.metadata ?? {},
    });

    if (error) {
      return {
        ok: false,
        code: 'RPC_ERROR',
        message: `[x402] consumePayment RPC failed: ${error.message}`,
      };
    }

    const row = (data as unknown as ConsumeRpcRow[])[0];
    return {
      ok: row.ok,
      code: row.code as X402ConsumeResult['code'],
      paymentId: row.existing_payment_id ?? input.paymentId,
      consumptionId: row.consumption_id ?? undefined,
      message: row.message,
    };
  },

  async getCachedResponse(cacheKey: string): Promise<X402CachedResponse | null> {
    const { data, error } = await supabaseAdmin
      .from('x402_response_cache')
      .select()
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`[x402] getCachedResponse failed: ${error.message}`);
    }
    return rowToCache(data as CacheRow);
  },

  async putCachedResponse(response: X402CachedResponse): Promise<X402CachedResponse> {
    const { data, error } = await supabaseAdmin
      .from('x402_response_cache')
      .upsert({
        cache_key: response.cacheKey,
        payment_id: response.paymentId,
        consumption_id: response.consumptionId,
        requirement_id: response.requirementId,
        resource: response.resource,
        status_code: response.statusCode,
        response_headers: response.responseHeaders,
        response_body: response.responseBody ?? null,
        body_text: response.bodyText ?? null,
        content_type: response.contentType ?? null,
        expires_at: response.expiresAt,
      })
      .select()
      .single();
    if (error) throw new Error(`[x402] putCachedResponse failed: ${error.message}`);
    return rowToCache(data as CacheRow);
  },
};
