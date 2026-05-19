import { NextRequest, NextResponse } from 'next/server';
import { claimA2AJob } from '@/lib/a2a/jobs';
import { requireApiKey } from '@/lib/a2a/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Phase 11: require API key with jobs:claim scope
  const auth = await requireApiKey(req, 'jobs:claim');
  if (auth.error) return auth.error;

  // The authenticated key dictates the agentId — body agentId is ignored to prevent
  // claim-on-behalf-of attacks where a leaked key could claim under a different ID.
  const agentId = auth.key.agentId;

  const result = await claimA2AJob(params.id, agentId);
  if (!result.ok) return NextResponse.json(result, { status: result.error === 'job_not_found' ? 404 : 409 });
  return NextResponse.json(result);
}
