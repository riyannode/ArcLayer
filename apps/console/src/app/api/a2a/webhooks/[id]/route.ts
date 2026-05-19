import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/a2a/auth';
import { deleteWebhook } from '@/lib/a2a/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE: Remove a webhook subscription */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiKey(req, 'webhooks:manage');
  if (auth.error) return auth.error;

  const ok = await deleteWebhook(params.id, auth.key.agentId);
  if (!ok) return NextResponse.json({ ok: false, error: 'not_found_or_unauthorized' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
