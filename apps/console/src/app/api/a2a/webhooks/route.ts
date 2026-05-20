import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/a2a/auth';
import { applyRateLimit } from '@/lib/rate-limit';
import { createWebhook, listWebhooks } from '@/lib/a2a/webhooks';
import { withX402 } from '@/lib/x402';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: Create a new webhook subscription */
async function postHandler(req: NextRequest) {
  const auth = await requireApiKey(req, 'webhooks:manage');
  if (auth.error) return auth.error;

  const limited = applyRateLimit(req, 'a2a:webhooks:create', { max: 10, agentId: auth.key.agentId });
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const { url, events } = body as { url?: string; events?: string[] };
  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    return NextResponse.json({ ok: false, error: 'url_required_https' }, { status: 400 });
  }

  const result = await createWebhook({
    agentId: auth.key.agentId,
    url,
    events: events as any,
  });

  if (!result.ok) return NextResponse.json(result, { status: 500 });

  return NextResponse.json({
    ok: true,
    webhook: result.webhook,
    secret: result.secret, // shown once
  }, { status: 201 });
}

// 0.000001 USDC = 1 atomic (6 decimals). Creating webhook subscriptions is a paid action.
export const POST = withX402(postHandler, {
  amount: '1',
  resource: '/api/a2a/webhooks',
  description: 'Create an A2A webhook subscription — anti-spam fee',
});

/** GET: List webhook subscriptions for the authenticated agent */
export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req, 'webhooks:manage');
  if (auth.error) return auth.error;

  const hooks = await listWebhooks(auth.key.agentId);
  return NextResponse.json({ ok: true, webhooks: hooks });
}
