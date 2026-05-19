import { NextRequest, NextResponse } from 'next/server';
import { submitA2AJob } from '@/lib/a2a/jobs';
import { requireApiKey } from '@/lib/a2a/auth';
import { applyRateLimit } from '@/lib/rate-limit';
import { recordDelivery } from '@/lib/a2a/reputation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Phase 11: require API key with jobs:submit scope
  const auth = await requireApiKey(req, 'jobs:submit');
  if (auth.error) return auth.error;

  // Phase 12: 60 submits per minute per agent
  const limited = applyRateLimit(req, 'a2a:jobs:submit', {
    max: 60,
    agentId: auth.key.agentId,
  });
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });

  const { output, proof, summary } = body as Record<string, unknown>;
  const result = await submitA2AJob(params.id, {
    agentId: auth.key.agentId,
    output,
    proof,
    summary: typeof summary === 'string' ? summary : undefined,
  });
  if (!result.ok) return NextResponse.json(result, { status: result.error === 'job_not_found' ? 404 : 403 });

  // Phase 13: fire-and-forget on-chain reputation recording
  recordDelivery({
    providerAgentId: auth.key.agentId,
    buyerAgentId: 'arclayer-system',
    jobId: params.id,
    delivered: true,
  }).catch((e) => console.error('[submit] recordDelivery error:', e));

  return NextResponse.json(result);
}
