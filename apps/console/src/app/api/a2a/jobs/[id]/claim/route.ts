import { NextRequest, NextResponse } from 'next/server';
import { claimA2AJob } from '@/lib/a2a/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const agentId = body && typeof body === 'object' && typeof (body as { agentId?: unknown }).agentId === 'string'
    ? (body as { agentId: string }).agentId.trim()
    : '';
  if (!agentId) return NextResponse.json({ ok: false, error: 'agentId_required' }, { status: 400 });
  const result = await claimA2AJob(params.id, agentId);
  if (!result.ok) return NextResponse.json(result, { status: result.error === 'job_not_found' ? 404 : 409 });
  return NextResponse.json(result);
}
