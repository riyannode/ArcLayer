import { NextRequest, NextResponse } from 'next/server';
import { createA2AJob, listA2AJobs } from '@/lib/a2a/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const jobs = listA2AJobs({
    status: url.searchParams.get('status'),
    agentId: url.searchParams.get('agentId'),
    roleId: url.searchParams.get('roleId'),
    category: url.searchParams.get('category'),
  });
  return NextResponse.json({ ok: true, jobs });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  const { title, description, category, roleId, budget, requester, agentId, input } = body as Record<string, unknown>;
  if (typeof title !== 'string' || typeof description !== 'string' || !title.trim() || !description.trim()) {
    return NextResponse.json({ ok: false, error: 'missing_fields', message: 'title and description are required' }, { status: 400 });
  }
  const job = createA2AJob({
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
