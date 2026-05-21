import { NextRequest, NextResponse } from 'next/server';
import { createA2AJob, listA2AJobs } from '@/lib/a2a/jobs';
import { applyRateLimit } from '@/lib/rate-limit';
import { withX402 } from '@/lib/x402';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const jobs = await listA2AJobs({
    status: url.searchParams.get('status'),
    agentId: url.searchParams.get('agentId'),
    roleId: url.searchParams.get('roleId'),
    category: url.searchParams.get('category'),
    evaluator: url.searchParams.get('evaluator'),
    provider: url.searchParams.get('provider'),
  });
  return NextResponse.json({ ok: true, jobs });
}

async function postHandler(req: NextRequest) {
  // Phase 12: 5 job creates per minute per IP
  const limited = applyRateLimit(req, 'a2a:jobs:create', { max: 5 });
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  const { title, description, category, roleId, budget, requester, agentId, input } = body as Record<string, unknown>;
  if (typeof title !== 'string' || typeof description !== 'string' || !title.trim() || !description.trim()) {
    return NextResponse.json({ ok: false, error: 'missing_fields', message: 'title and description are required' }, { status: 400 });
  }
  const job = await createA2AJob({
    title,
    description,
    category: typeof category === 'string' ? category : undefined,
    roleId: typeof roleId === 'string' ? roleId : undefined,
    budget: typeof budget === 'string' ? budget : undefined,
    requester: typeof requester === 'string' ? requester : undefined,
    agentId: typeof agentId === 'string' ? agentId : undefined,
    input,
  });
  return NextResponse.json({ ok: true, job }, { status: 201 });
}

// 0.000001 USDC = 1 atomic (6 decimals). Creating a job is a paid action.
export const POST = withX402(postHandler, {
  amount: '1',
  resource: '/api/a2a/jobs',
  description: 'Create a new A2A job — anti-spam fee',
});
