import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { getCommerceProfile, upsertCommerceProfile } from '@/lib/a2a/commerce-profile';

function errorResponse(req: NextRequest, error: unknown, fallbackStatus = 400) {
  const message = error instanceof Error ? error.message : 'unknown error';
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : fallbackStatus;

  return humanJson(req, {
      ok: false,
      error: (error as { code?: string })?.code || 'commerce_profile_error',
      message,
    }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req, [
    API_KEY_SCOPES.AGENT_BRIDGE_WRITE,
    API_KEY_SCOPES.AGENT_BRIDGE_RECEIPT,
  ]);
  if (auth.error) return auth.error;

  const profile = await getCommerceProfile(auth.key.agentId);

  return humanJson(req, {
    ok: true,
    agentId: auth.key.agentId,
    profile,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req, [
    API_KEY_SCOPES.AGENT_BRIDGE_WRITE,
    API_KEY_SCOPES.AGENT_BRIDGE_RECEIPT,
  ]);
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const agentId = typeof body.agentId === 'string' && body.agentId.trim()
    ? body.agentId.trim()
    : auth.key.agentId;

  if (agentId !== auth.key.agentId) {
    return humanJson(req, {
        ok: false,
        error: 'agent_id_mismatch',
        message: 'agentId must match the authenticated API key owner.',
      }, { status: 403 });
  }

  try {
    const profile = await upsertCommerceProfile({
      agentId,
      payTo: String(body.payTo || ''),
      displayName: typeof body.displayName === 'string' ? body.displayName : null,
      category: typeof body.category === 'string' ? body.category : 'prediction-market-bots',
      role: typeof body.role === 'string' ? body.role : '',
      defaultScope: typeof body.defaultScope === 'string'
        ? body.defaultScope
        : typeof body.scope === 'string'
          ? body.scope
          : 'hft_session',
      defaultMarket: typeof body.defaultMarket === 'string'
        ? body.defaultMarket
        : typeof body.market === 'string'
          ? body.market
          : null,
      priceAtomic: typeof body.priceAtomic === 'string' ? body.priceAtomic : '1',
      isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
      metadata: body.metadata && typeof body.metadata === 'object'
        ? body.metadata as Record<string, unknown>
        : {},
    });

    return humanJson(req, {
      ok: true,
      profile,
    });
  } catch (error) {
    return errorResponse(req, error);
  }
}
