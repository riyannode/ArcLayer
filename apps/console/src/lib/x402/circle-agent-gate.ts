import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { getBridgeReceiptByPayload, insertBridgeReceipt } from '@/lib/agent-bridge/store';
import { withX402 } from '@/lib/x402/middleware';
import { resolveCircleAgentGate } from '@/lib/x402/circle-agent-policy';
import { sanitizeLlmReceipt, type SanitizedLlmReceipt } from '@/lib/x402/llm-receipt';

export type CircleAgentGateHandlerContext = {
  category: string;
  role: string;
  scope: string;
  market: string;
  sessionId: string;
  agentId: string;
  runtimeId: string | null;
  payloadHash: string;
  reputationEligible: boolean;
  llmReceipt: SanitizedLlmReceipt | null;
};

export function withCircleAgentGate(
  handler?: (req: NextRequest, ctx: CircleAgentGateHandlerContext) => Promise<NextResponse>,
) {
  return async function circleAgentGatePost(req: NextRequest): Promise<NextResponse> {
    const auth = await requireApiKey(req, [
      API_KEY_SCOPES.AGENT_BRIDGE_WRITE,
      API_KEY_SCOPES.AGENT_BRIDGE_RECEIPT,
    ]);
    if (auth.error) return auth.error;

    const body = await req.clone().json().catch(() => ({} as Record<string, unknown>));

    const resolved = resolveCircleAgentGate(body);
    if (!resolved.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: resolved.error,
          message: resolved.message,
          details: resolved.details,
        },
        { status: resolved.status },
      );
    }

    const ctx = resolved.ctx;

    if (ctx.agentId !== auth.key.agentId) {
      return NextResponse.json(
        {
          ok: false,
          error: 'agent_id_mismatch',
          message: 'agentId must match the authenticated API key owner.',
          field: 'agentId',
        },
        { status: 403 },
      );
    }

    const llmReceiptResult = sanitizeLlmReceipt(body.llmReceipt);
    if (!llmReceiptResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: llmReceiptResult.error,
          message: llmReceiptResult.message,
        },
        { status: 400 },
      );
    }

    if (ctx.llmReceiptRequired && !llmReceiptResult.receipt) {
      return NextResponse.json(
        {
          ok: false,
          error: 'llm_receipt_required',
          message: `${ctx.category}/${ctx.role}/${ctx.scope} requires llmReceipt.summary.`,
        },
        { status: 400 },
      );
    }

    const existingReceipt = await getBridgeReceiptByPayload({
      sessionId: ctx.sessionId,
      receiptType: 'x402_circle_gateway',
      payloadHash: ctx.payloadHash,
      category: ctx.category,
      role: ctx.role,
      scope: ctx.scope,
      market: ctx.market,
      agentId: ctx.agentId,
    }).catch((err) => {
      console.error('[circle-agent-gate] receipt precheck failed:', err instanceof Error ? err.message : 'unknown');
      return null;
    });

    if (existingReceipt) {
      return NextResponse.json({
        ok: true,
        cached: true,
        access: 'already_unlocked',
        rail: 'circle_agent_gate',
        settlementRail: 'x402_circle_gateway',
        receipt: existingReceipt,
        category: ctx.category,
        role: ctx.role,
        scope: ctx.scope,
        market: ctx.market,
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        payloadHash: ctx.payloadHash,
      });
    }

    const gateCtx: CircleAgentGateHandlerContext = {
      category: ctx.category,
      role: ctx.role,
      scope: ctx.scope,
      market: ctx.market,
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      runtimeId: ctx.runtimeId,
      payloadHash: ctx.payloadHash,
      reputationEligible: ctx.reputationEligible,
      llmReceipt: llmReceiptResult.receipt,
    };

    const protectedHandler = async (innerReq: NextRequest) => {
      if (handler) return handler(innerReq, gateCtx);
      const response = NextResponse.json({
        ok: true,
        access: 'unlocked',
        rail: 'circle_agent_gate',
        settlementRail: 'x402_circle_gateway',
        category: ctx.category,
        role: ctx.role,
        scope: ctx.scope,
        market: ctx.market,
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        runtimeId: ctx.runtimeId,
        payloadHash: ctx.payloadHash,
        reputationEligible: ctx.reputationEligible,
        llmReceipt: llmReceiptResult.receipt
          ? {
              summary: llmReceiptResult.receipt.summary,
              model: llmReceiptResult.receipt.model,
              decision: llmReceiptResult.receipt.decision,
              confidence: llmReceiptResult.receipt.confidence,
            }
          : null,
      });

      response.headers.set('X-ArcLayer-Agent-Id', ctx.agentId);
      response.headers.set('X-ArcLayer-Agent-Category', ctx.category);
      response.headers.set('X-ArcLayer-Agent-Role', ctx.role);
      response.headers.set('X-ArcLayer-Market', ctx.market);
      response.headers.set('X-ArcLayer-Scope', ctx.scope);
      response.headers.set('X-ArcLayer-Session-Id', ctx.sessionId);
      response.headers.set('X-ArcLayer-Payload-Hash', ctx.payloadHash);

      return response;
    };

    return withX402(protectedHandler, {
      amount: ctx.amountAtomic,
      resource: ctx.resource,
      description: `Circle x402 gate: ${ctx.category}/${ctx.market}/${ctx.role}/${ctx.scope}`,
      allowedRails: ['circle-gateway-passkey'],
      liveAgentId: ctx.agentId,
      liveAgentName: `${ctx.category}:${ctx.role}`,
      onSettled: async (settle) => {
        const duplicate = await getBridgeReceiptByPayload({
          sessionId: ctx.sessionId,
          receiptType: 'x402_circle_gateway',
          payloadHash: ctx.payloadHash,
          category: ctx.category,
          role: ctx.role,
          scope: ctx.scope,
          market: ctx.market,
          agentId: ctx.agentId,
        }).catch((err) => {
          console.error('[circle-agent-gate] onSettled duplicate check failed:', err instanceof Error ? err.message : 'unknown');
          return null;
        });

        if (duplicate) {
          console.log(
            '[circle-agent-gate] receipt already exists session=%s payloadHash=%s receiptId=%s',
            ctx.sessionId,
            ctx.payloadHash,
            duplicate.id,
          );
          return;
        }

        await insertBridgeReceipt({
          sessionId: ctx.sessionId,
          receiptType: 'x402_circle_gateway',
          paymentId: settle.paymentId,
          transaction: settle.transaction,
          payloadHash: ctx.payloadHash,
          metadata: {
            category: ctx.category,
            role: ctx.role,
            scope: ctx.scope,
            market: ctx.market,
            agentId: ctx.agentId,
            runtimeId: ctx.runtimeId,
            payer: settle.payer,
            payTo: settle.payTo,
            amount: settle.amount,
            resource: settle.resource,
            rail: 'x402_circle_gateway',
            reputationEligible: ctx.reputationEligible,
            llmReceipt: llmReceiptResult.receipt,
          },
        });
      },
    })(req);
  };
}
