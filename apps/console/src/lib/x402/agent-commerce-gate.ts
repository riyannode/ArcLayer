import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { getBridgeReceiptByPayload, insertBridgeReceipt, listBridgeEvents } from '@/lib/agent-bridge/store';
import { withX402 } from '@/lib/x402/middleware';
import { sanitizeLlmReceipt } from '@/lib/x402/llm-receipt';
import { getActiveServiceGate, normalizeOptionalAddress } from '@/lib/a2a/service-gates';
import {
  normalizeAgentCommerceGateRequest,
  validateAgentCommerceBuyerPolicy,
  validateAgentCommerceFallbackPolicy,
  type AgentCommerceGateContext,
  type AgentCommerceNormalizedGateContext,
} from '@/lib/x402/agent-commerce-policy';
import { resolveSellerCommerceProfile } from '@/lib/a2a/commerce-profile';
import { resolveX402ServicePayoutAddress } from '@/lib/x402/service-payout';

function errorJson(status: number, error: string, message: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    {
      ok: false,
      error,
      message,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

async function validateCommerceSession(ctx: AgentCommerceNormalizedGateContext) {
  const events = await listBridgeEvents({
    sessionId: ctx.sessionId,
    category: ctx.category,
    agentId: ctx.buyerAgentId,
    limit: 10,
  });

  if (!events.length) {
    return {
      ok: false as const,
      status: 404,
      error: 'commerce_session_not_found',
      message: 'Create at least one bridge event before paying seller commerce gate.',
      details: {
        sessionId: ctx.sessionId,
        category: ctx.category,
      },
    };
  }

  return { ok: true as const };
}

export function withPredictionMarketSellerCommerceGate(
  handler?: (req: NextRequest, ctx: AgentCommerceGateContext) => Promise<NextResponse>,
) {
  return async function predictionMarketSellerCommerceGatePost(req: NextRequest): Promise<NextResponse> {
    const auth = await requireApiKey(req, [
      API_KEY_SCOPES.AGENT_BRIDGE_WRITE,
      API_KEY_SCOPES.AGENT_BRIDGE_RECEIPT,
    ]);
    if (auth.error) return auth.error;

    const body = await req.clone().json().catch(() => ({} as Record<string, unknown>));

    const resolved = normalizeAgentCommerceGateRequest(body);
    if (!resolved.ok) {
      return errorJson(resolved.status, resolved.error, resolved.message, resolved.details);
    }

    const ctx = resolved.ctx;

    if (ctx.buyerAgentId !== auth.key.agentId) {
      return errorJson(
        403,
        'buyer_agent_id_mismatch',
        'buyerAgentId must match the authenticated API key owner.',
        {
          buyerAgentId: ctx.buyerAgentId,
          authenticatedAgentId: auth.key.agentId,
        },
      );
    }

    const session = await validateCommerceSession(ctx).catch((err) => ({
      ok: false as const,
      status: 500,
      error: 'commerce_session_validation_failed',
      message: err instanceof Error ? err.message : 'unknown session validation error',
      details: {
        sessionId: ctx.sessionId,
        category: ctx.category,
      },
    }));

    if (!session.ok) {
      return errorJson(session.status, session.error, session.message, session.details);
    }

    const buyerPolicy = validateAgentCommerceBuyerPolicy(ctx);
    if (!buyerPolicy.ok) {
      return errorJson(
        buyerPolicy.status,
        buyerPolicy.error,
        buyerPolicy.message,
        buyerPolicy.details,
      );
    }

    const serviceGate = await getActiveServiceGate({
      serviceAgentId: ctx.sellerAgentId,
      gateKey: ctx.gateKey,
      category: ctx.category,
      serviceRole: ctx.sellerRole,
      scope: ctx.scope,
      accessType: ctx.accessType,
      market: ctx.market,
      rail: 'circle-gateway',
    }).catch((err) => {
      const status = typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : 500;
      const code = typeof (err as { code?: unknown })?.code === 'string'
        ? (err as { code: string }).code
        : 'service_gate_lookup_failed';
      const message = err instanceof Error ? err.message : 'service gate lookup failed';
      return { error: true as const, status, code, message };
    });

    if (serviceGate && 'error' in serviceGate) {
      return errorJson(serviceGate.status, serviceGate.code, serviceGate.message, {
        serviceAgentId: ctx.sellerAgentId,
        serviceRole: ctx.sellerRole,
        gateKey: ctx.gateKey,
      });
    }

    if (!serviceGate && ctx.gateKey) {
      return errorJson(
        404,
        'service_gate_not_found',
        'Requested service gate was not found or is inactive.',
        {
          serviceAgentId: ctx.sellerAgentId,
          serviceRole: ctx.sellerRole,
          gateKey: ctx.gateKey,
          category: ctx.category,
          scope: ctx.scope,
          accessType: ctx.accessType,
          market: ctx.market,
        },
      );
    }

    let sellerProfile: Awaited<ReturnType<typeof resolveSellerCommerceProfile>> | null = null;
    let resolvedPriceAtomic: string;
    let reputationEligible: boolean;
    let llmReceiptRequired: boolean;
    let servicePayoutAddress: `0x${string}`;

    if (serviceGate) {
      resolvedPriceAtomic = serviceGate.price_atomic;
      reputationEligible = serviceGate.reputation_eligible;
      llmReceiptRequired = serviceGate.llm_receipt_required;
      if (serviceGate.pay_to) {
        try {
          servicePayoutAddress = normalizeOptionalAddress(serviceGate.pay_to) as `0x${string}`;
        } catch {
          return errorJson(500, 'service_gate_pay_to_invalid', 'Service gate pay_to must be a valid EVM address.', {
            serviceAgentId: ctx.sellerAgentId,
            serviceGateId: serviceGate.id,
          });
        }
      } else {
        try {
          servicePayoutAddress = await resolveX402ServicePayoutAddress({
            serviceAgentId: ctx.sellerAgentId,
          });
        } catch (err) {
          const code = (err as { code?: string })?.code || 'service_payout_address_missing';
          return errorJson(
            code === 'service_payout_address_invalid' ? 500 : 403,
            code,
            code,
            { serviceAgentId: ctx.sellerAgentId },
          );
        }
      }
    } else {
      const fallbackPolicy = validateAgentCommerceFallbackPolicy(ctx, body);
      if (!fallbackPolicy.ok) {
        return errorJson(fallbackPolicy.status, fallbackPolicy.error, fallbackPolicy.message, fallbackPolicy.details);
      }

      const resolvedSellerProfile = await resolveSellerCommerceProfile({
        sellerAgentId: ctx.sellerAgentId,
        category: ctx.category,
        sellerRole: ctx.sellerRole,
        market: ctx.market,
        scope: ctx.scope,
      }).catch((err) => {
        const status = typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
        const code = typeof (err as { code?: unknown })?.code === 'string'
          ? (err as { code: string }).code
          : 'seller_commerce_profile_error';
        const message = err instanceof Error ? err.message : 'seller commerce profile error';
        return { error: true as const, status, code, message };
      });

      if ('error' in resolvedSellerProfile) {
        return errorJson(resolvedSellerProfile.status, resolvedSellerProfile.code, resolvedSellerProfile.message, {
          sellerAgentId: ctx.sellerAgentId,
          sellerRole: ctx.sellerRole,
        });
      }

      sellerProfile = resolvedSellerProfile;
      resolvedPriceAtomic = sellerProfile.price_atomic;
      reputationEligible = fallbackPolicy.reputationEligible;
      llmReceiptRequired = fallbackPolicy.llmReceiptRequired;

      try {
        servicePayoutAddress = await resolveX402ServicePayoutAddress({
          serviceAgentId: ctx.sellerAgentId,
        });
      } catch (err) {
        const code = (err as { code?: string })?.code || 'service_payout_address_missing';
        return errorJson(
          code === 'service_payout_address_invalid' ? 500 : 403,
          code,
          code,
          { serviceAgentId: ctx.sellerAgentId },
        );
      }
    }

    const commerceCtx: AgentCommerceGateContext = {
      ...ctx,
      amountAtomic: resolvedPriceAtomic,
      reputationEligible,
      llmReceiptRequired,
    };

    const llmReceiptResult = sanitizeLlmReceipt(body.llmReceipt);
    if (!llmReceiptResult.ok) {
      return errorJson(400, llmReceiptResult.error, llmReceiptResult.message);
    }

    if (llmReceiptRequired && !llmReceiptResult.receipt) {
      return errorJson(
        400,
        'llm_receipt_required',
        `${ctx.category}/${ctx.sellerRole}/${ctx.accessType} requires llmReceipt.summary.`,
      );
    }

    const existingReceipt = await getBridgeReceiptByPayload({
      sessionId: ctx.sessionId,
      receiptType: 'x402_circle_commerce',
      payloadHash: ctx.payloadHash,
      category: ctx.category,
      role: ctx.buyerRole,
      scope: ctx.scope,
      market: ctx.market,
      agentId: ctx.buyerAgentId,
      buyerAgentId: ctx.buyerAgentId,
      sellerAgentId: ctx.sellerAgentId,
      sellerRole: ctx.sellerRole,
      accessType: ctx.accessType,
    }).catch((err) => {
      console.error('[agent-commerce-gate] receipt precheck failed:', err instanceof Error ? err.message : 'unknown');
      return null;
    });

    if (existingReceipt) {
      return NextResponse.json({
        ok: true,
        cached: true,
        access: 'already_unlocked',
        rail: 'agent_commerce_gate',
        settlementRail: 'x402_circle_commerce',
        receipt: existingReceipt,
        category: ctx.category,
        buyerAgentId: ctx.buyerAgentId,
        buyerRole: ctx.buyerRole,
        sellerAgentId: ctx.sellerAgentId,
        sellerRole: ctx.sellerRole,
        scope: ctx.scope,
        market: ctx.market,
        sessionId: ctx.sessionId,
        payloadHash: ctx.payloadHash,
      });
    }

    const protectedHandler = async (innerReq: NextRequest) => {
      if (handler) return handler(innerReq, commerceCtx);

      const response = NextResponse.json({
        ok: true,
        access: 'unlocked',
        rail: 'agent_commerce_gate',
        settlementRail: 'x402_circle_commerce',
        category: ctx.category,
        buyerAgentId: ctx.buyerAgentId,
        buyerRole: ctx.buyerRole,
        sellerAgentId: ctx.sellerAgentId,
        sellerRole: ctx.sellerRole,
        scope: ctx.scope,
        market: ctx.market,
        accessType: ctx.accessType,
        sessionId: ctx.sessionId,
        payloadHash: ctx.payloadHash,
        serviceAgentId: ctx.sellerAgentId,
        serviceRole: ctx.sellerRole,
        gateKey: ctx.gateKey,
        serviceGateId: serviceGate?.id ?? null,
        priceSource: serviceGate ? 'service_gate' : 'seller_profile',
        servicePayoutAddress,
        llmReceipt: llmReceiptResult.receipt
          ? {
              summary: llmReceiptResult.receipt.summary,
              model: llmReceiptResult.receipt.model,
              decision: llmReceiptResult.receipt.decision,
              confidence: llmReceiptResult.receipt.confidence,
            }
          : null,
      });

      response.headers.set('X-ArcLayer-Buyer-Agent-Id', ctx.buyerAgentId);
      response.headers.set('X-ArcLayer-Seller-Agent-Id', ctx.sellerAgentId);
      response.headers.set('X-ArcLayer-Agent-Category', ctx.category);
      response.headers.set('X-ArcLayer-Buyer-Role', ctx.buyerRole);
      response.headers.set('X-ArcLayer-Seller-Role', ctx.sellerRole);
      response.headers.set('X-ArcLayer-Market', ctx.market);
      response.headers.set('X-ArcLayer-Scope', ctx.scope);
      response.headers.set('X-ArcLayer-Session-Id', ctx.sessionId);
      response.headers.set('X-ArcLayer-Payload-Hash', ctx.payloadHash);

      return response;
    };

    return withX402(protectedHandler, {
      amount: resolvedPriceAtomic,
      payTo: servicePayoutAddress,
      resource: ctx.resource,
      description: `Prediction-market commerce: ${ctx.buyerAgentId}/${ctx.buyerRole} pays ${ctx.sellerAgentId}/${ctx.sellerRole} for ${ctx.accessType}`,
      allowedRails: ['circle-gateway-passkey'],
      requireExplicitPayTo: true,
      liveAgentId: ctx.buyerAgentId,
      liveAgentName: `${ctx.category}:${ctx.buyerRole}`,
      onSettled: async (settle) => {
        const duplicate = await getBridgeReceiptByPayload({
          sessionId: ctx.sessionId,
          receiptType: 'x402_circle_commerce',
          payloadHash: ctx.payloadHash,
          category: ctx.category,
          role: ctx.buyerRole,
          scope: ctx.scope,
          market: ctx.market,
          agentId: ctx.buyerAgentId,
          buyerAgentId: ctx.buyerAgentId,
          sellerAgentId: ctx.sellerAgentId,
          sellerRole: ctx.sellerRole,
          accessType: ctx.accessType,
        }).catch(() => null);

        if (duplicate) return;

        await insertBridgeReceipt({
          sessionId: ctx.sessionId,
          receiptType: 'x402_circle_commerce',
          paymentId: settle.paymentId,
          transaction: settle.transaction,
          payloadHash: ctx.payloadHash,
          metadata: {
            category: ctx.category,
            role: ctx.buyerRole,
            agentId: ctx.buyerAgentId,
            scope: ctx.scope,
            market: ctx.market,
            accessType: ctx.accessType,
            sourcePayloadHash: ctx.sourcePayloadHash,
            buyerAgentId: ctx.buyerAgentId,
            buyerRole: ctx.buyerRole,
            sellerAgentId: ctx.sellerAgentId,
            sellerRole: ctx.sellerRole,
            serviceAgentId: ctx.sellerAgentId,
            servicePayoutAddress,
            sellerProfileAgentId: sellerProfile?.agent_id ?? null,
            serviceRole: ctx.sellerRole,
            gateKey: ctx.gateKey,
            serviceGateId: serviceGate?.id ?? null,
            priceSource: serviceGate ? 'service_gate' : 'seller_profile',
            payer: settle.payer,
            payTo: settle.payTo,
            amount: settle.amount,
            resource: settle.resource,
            rail: 'x402_circle_commerce',
            reputationEligible,
            llmReceipt: llmReceiptResult.receipt,
          },
        });
      },
    })(req);
  };
}
