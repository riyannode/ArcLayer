import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { claimA2AJob } from '@/lib/a2a/jobs';
import { requireApiKey } from '@/lib/a2a/auth';
import { applyRateLimit } from '@/lib/rate-limit';
import { requireRegisteredExternalAgent } from '@/lib/a2a/external-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
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
  if (!(await requireRegisteredExternalAgent(agentId))) {
    console.warn(`[a2a] rejected unregistered external agent agentId=${agentId}`);
    return humanJson(req, { ok: false, error: 'unregistered_external_agent' }, { status: 403 });
  }

  const result = await claimA2AJob(id, agentId);
  if (!result.ok) return humanJson(req, result, { status: result.error === 'job_not_found' ? 404 : 409 });
  return humanJson(req, result);
}
