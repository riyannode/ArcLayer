import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { createA2AJob, listA2AJobs } from '@/lib/a2a/jobs';
import { applyRateLimit } from '@/lib/rate-limit';
import { withX402 } from '@/lib/x402';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const JOBS_TTL_MS = 30_000;
const JOBS_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';
const jobsCache = new Map<string, { expiresAt: number; payload: unknown }>();

export async function GET(req: NextRequest) {
  const cacheKey = req.url;
  const cached = jobsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return humanJson(req, cached.payload, {
      headers: { 'Cache-Control': JOBS_CACHE_CONTROL },
    });
  }
  const url = new URL(req.url);
  const jobs = await listA2AJobs({
    status: url.searchParams.get('status'),
    agentId: url.searchParams.get('agentId'),
    roleId: url.searchParams.get('roleId'),
    category: url.searchParams.get('category'),
    evaluator: url.searchParams.get('evaluator'),
    provider: url.searchParams.get('provider'),
  });
  const payload = { ok: true, jobs };
  jobsCache.set(cacheKey, { expiresAt: Date.now() + JOBS_TTL_MS, payload });
  return humanJson(req, payload, {
    headers: { 'Cache-Control': JOBS_CACHE_CONTROL },
  });
}

async function postHandler(req: NextRequest) {
  // Phase 12: 5 job creates per minute per IP
  const limited = applyRateLimit(req, 'a2a:jobs:create', { max: 5 });
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return humanJson(req, { ok: false, error: 'invalid_json' }, { status: 400 });
  const { title, description, category, roleId, budget, requester, agentId, input } = body as Record<string, unknown>;
  if (typeof title !== 'string' || typeof description !== 'string' || !title.trim() || !description.trim()) {
    return humanJson(req, { ok: false, error: 'missing_fields', message: 'title and description are required' }, { status: 400 });
  }
  const result = await createA2AJob({
    title,
    description,
    category: typeof category === 'string' ? category : undefined,
    roleId: typeof roleId === 'string' ? roleId : undefined,
    budget: typeof budget === 'string' ? budget : undefined,
    requester: typeof requester === 'string' ? requester : undefined,
    agentId: typeof agentId === 'string' ? agentId : undefined,
    input,
  });
  if (!result.ok) {
    return humanJson(req, { ok: false, error: result.error, detail: result.detail }, { status: 502, headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' } });
  }
  return humanJson(req, { ok: true, job: result.job }, { status: 201 });
}

// 0.000001 USDC = 1 atomic (6 decimals). Creating a job is a paid action.
export const POST = withX402(postHandler, {
  amount: '1',
  resource: '/api/a2a/jobs',
  description: 'Create a new A2A job — anti-spam fee',
});
