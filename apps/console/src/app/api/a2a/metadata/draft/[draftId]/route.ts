import { NextRequest, NextResponse } from 'next/server';
import {
  getMetadataDraft,
  updateMetadataDraft,
} from '@/lib/a2a/metadata-drafts/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ draftId: string }> }
) {
  const { draftId } = await ctx.params;
  const record = await getMetadataDraft(draftId);

  if (!record) {
    return NextResponse.json({ error: 'metadata draft not found' }, { status: 404 });
  }

  return NextResponse.json(record.metadata, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ draftId: string }> }
) {
  const { draftId } = await ctx.params;

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 });
  }

  const { writeToken, metadata, agentId, txHash } = body as {
    writeToken?: unknown;
    metadata?: unknown;
    agentId?: unknown;
    txHash?: unknown;
  };

  if (typeof writeToken !== 'string' || !writeToken) {
    return NextResponse.json({ error: 'writeToken is required' }, { status: 400 });
  }

  if (!metadata || typeof metadata !== 'object') {
    return NextResponse.json({ error: 'metadata must be an object' }, { status: 400 });
  }

  const result = await updateMetadataDraft({
    draftId,
    writeToken,
    metadata,
    agentId: typeof agentId === 'string' ? agentId : undefined,
    txHash: typeof txHash === 'string' ? txHash : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
