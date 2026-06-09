import { humanJson } from '@/lib/api/human-json';
import { isAddress } from 'viem';
import { registerExternalAgent } from '@/lib/a2a/external-registry';
import { verifyExternalRegistrationAuth } from '@/lib/a2a/registration-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const agentId = typeof body?.agentId === 'string' ? body.agentId.trim() : '';
    const address = typeof body?.address === 'string' ? body.address.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : undefined;
    const capabilities = Array.isArray(body?.capabilities) ? body.capabilities.filter((v: unknown): v is string => typeof v === 'string') : undefined;
    const message = typeof body?.message === 'string' ? body.message : undefined;
    const signature = typeof body?.signature === 'string' ? body.signature : undefined;

    if (!agentId) return humanJson(request, { error: 'invalid_agent_id' }, { status: 400 });
    if (!isAddress(address)) return humanJson(request, { error: 'invalid_address' }, { status: 400 });
    if (endpoint) {
      const ok = endpoint.startsWith('http://') || endpoint.startsWith('https://');
      if (!ok) return humanJson(request, { error: 'invalid_endpoint' }, { status: 400 });
    }
    if (body?.capabilities !== undefined && !Array.isArray(body.capabilities)) {
      return humanJson(request, { error: 'invalid_capabilities' }, { status: 400 });
    }

    const { signatureVerified } = await verifyExternalRegistrationAuth({ address, message, signature });
    const autoApprove = process.env.A2A_AUTO_APPROVE_EXTERNAL_AGENTS === 'true';

    const result = await registerExternalAgent({
      agentId,
      address,
      owner: address,
      name,
      endpoint,
      capabilities,
      status: autoApprove && signatureVerified ? 'approved' : 'pending',
      source: 'external-registration',
    });

    return humanJson(request, result.agent, { status: result.created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'internal_error';
    if (message === 'invalid_address' || message === 'signature_required' || message === 'invalid_signature') {
      return humanJson(request, { error: message }, { status: 400 });
    }
    if (message === 'duplicate_agent_id') return humanJson(request, { error: message }, { status: 409 });
    if (message === 'external_registry_path_not_configured') return humanJson(request, { error: message }, { status: 503 });
    return humanJson(request, { error: 'internal_error' }, { status: 500 });
  }
}
