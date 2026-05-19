import { NextRequest, NextResponse } from 'next/server';
import { submitA2AJob } from '@/lib/a2a/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  const { agentId, output, proof, summary } = body as Record<string, unknown>;
  if (typeof agentId !== 'string' || !agentId.trim()) return NextResponse.json({ ok: false, error: 'agentId_required' }, { status: 400 });
  const result = await submitA2AJob(params.id, {
    agentId: agentId.trim(),
    output,
    proof,
    summary: typeof summary === 'string' ? summary : undefined,
  });
  if (!result.ok) return NextResponse.json(result, { status: result.error === 'job_not_found' ? 404 : 403 });
  return NextResponse.json(result);
}
