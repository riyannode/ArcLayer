import { NextResponse } from 'next/server';
import { requireA2AAdmin } from '@/lib/a2a/admin-auth';
import { blockExternalAgent } from '@/lib/a2a/external-registry';

export async function PATCH(request: Request, { params }: { params: { agentId: string } }) {
  const authError = requireA2AAdmin(request);
  if (authError) return authError;

  const entry = await blockExternalAgent(params.agentId);
  if (!entry) return NextResponse.json({ ok: false, error: 'agent_not_found' }, { status: 404 });
  console.log(`[a2a] external agent blocked agentId=${entry.agentId}`);
  return NextResponse.json({ ok: true, agent: entry });
}
