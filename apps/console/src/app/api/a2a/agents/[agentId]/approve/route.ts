import { NextResponse } from 'next/server';
import { requireA2aAdmin } from '@/lib/a2a/admin-auth';
import { approveExternalAgent } from '@/lib/a2a/external-registry';

export async function PATCH(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const authError = requireA2aAdmin(request);
  if (authError) return authError;
  const { agentId } = await context.params;
  const updated = await approveExternalAgent(agentId);
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(updated);
}
