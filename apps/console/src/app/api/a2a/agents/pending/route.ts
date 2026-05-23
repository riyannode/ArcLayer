import { NextResponse } from 'next/server';
import { requireA2AAdmin } from '@/lib/a2a/admin-auth';
import { listPendingExternalAgents } from '@/lib/a2a/external-registry';

export async function GET(request: Request) {
  const authError = requireA2AAdmin(request);
  if (authError) return authError;

  const agents = await listPendingExternalAgents();
  return NextResponse.json({ ok: true, total: agents.length, agents });
}
