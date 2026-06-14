import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { listServiceGates, serviceGateError, upsertServiceGate } from '@/lib/a2a/service-gates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function errorJson(status: number, error: string, message: string, details?: unknown) {
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

function toRouteError(error: unknown) {
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : 500;
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : 'service_gate_error';
  const message = error instanceof Error ? error.message : 'service gate error';
  return errorJson(status, code, message, (error as { details?: unknown })?.details);
}

function requireOwnServiceAgentId(serviceAgentId: string, authenticatedAgentId: string) {
  if (serviceAgentId !== authenticatedAgentId) {
    throw serviceGateError(
      'service_agent_forbidden',
      'API keys may only manage service gates for their own agent.',
      403,
      { serviceAgentId, authenticatedAgentId },
    );
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req, API_KEY_SCOPES.AGENT_BRIDGE_WRITE);
  if (auth.error) return auth.error;

  const url = new URL(req.url);
  const serviceAgentId = url.searchParams.get('serviceAgentId')?.trim() || auth.key.agentId;

  try {
    requireOwnServiceAgentId(serviceAgentId, auth.key.agentId);
    const gates = await listServiceGates(serviceAgentId);
    return NextResponse.json({ ok: true, count: gates.length, gates });
  } catch (error) {
    return toRouteError(error);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req, API_KEY_SCOPES.AGENT_BRIDGE_WRITE);
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorJson(400, 'invalid_json', 'Request body must be a JSON object.');
  }

  const input = body as Record<string, unknown>;
  const serviceAgentId = typeof input.serviceAgentId === 'string' && input.serviceAgentId.trim()
    ? input.serviceAgentId.trim()
    : auth.key.agentId;

  try {
    requireOwnServiceAgentId(serviceAgentId, auth.key.agentId);
    const gate = await upsertServiceGate({
      serviceAgentId,
      gateKey: String(input.gateKey ?? ''),
      category: typeof input.category === 'string' ? input.category : 'prediction-market-bots',
      serviceRole: String(input.serviceRole ?? ''),
      scope: String(input.scope ?? ''),
      accessType: String(input.accessType ?? ''),
      market: typeof input.market === 'string' ? input.market : '*',
      priceAtomic: String(input.priceAtomic ?? ''),
      rail: typeof input.rail === 'string' ? input.rail as 'circle-gateway' : 'circle-gateway',
      payTo: input.payTo,
      reputationEligible: typeof input.reputationEligible === 'boolean' ? input.reputationEligible : undefined,
      llmReceiptRequired: typeof input.llmReceiptRequired === 'boolean' ? input.llmReceiptRequired : undefined,
      metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
        ? input.metadata as Record<string, unknown>
        : undefined,
      isActive: typeof input.isActive === 'boolean' ? input.isActive : undefined,
    });

    return NextResponse.json({ ok: true, gate });
  } catch (error) {
    return toRouteError(error);
  }
}
