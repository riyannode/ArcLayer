import { NextRequest, NextResponse } from 'next/server';
import { claimA2AJob } from '@/lib/a2a/jobs';
import { requireApiKey } from '@/lib/a2a/auth';
import { applyRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Phase 11: require API key with jobs:claim scope
  const auth = await requireApiKey(req, 'jobs:claim');
  if (auth.error) return auth.error;

  // Phase 12: 30 claims per minute per agent
  const limited = applyRateLimit(req, 'a2a:jobs:claim', {
    max: 30,
    agentId: auth.key.agentId,
  });
  if (limited) return limited;

  const agentId = auth.key.agentId;

  const result = await claimA2AJob(params.id, agentId);
  if (!result.ok) return NextResponse.json(result, { status: result.error === 'job_not_found' ? 404 : 409 });
  return NextResponse.json(result);
}
