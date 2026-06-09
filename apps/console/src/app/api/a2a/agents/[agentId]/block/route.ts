import { humanJson } from '@/lib/api/human-json';
import { requireA2aAdmin } from '@/lib/a2a/admin-auth';
import { blockExternalAgent } from '@/lib/a2a/external-registry';

export async function PATCH(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const authError = requireA2aAdmin(request);
  if (authError) return authError;
  const { agentId } = await context.params;
  const updated = await blockExternalAgent(agentId);
  if (!updated) return humanJson(request, { error: 'not_found' }, { status: 404 });
  return humanJson(request, updated);
}
