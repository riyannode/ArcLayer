import { NextResponse } from 'next/server';
import { getAddress, isAddress, recoverMessageAddress } from 'viem';
import { registerExternalAgent } from '@/lib/a2a/external-registry';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });

  const agentId = asString(body.agentId);
  const address = asString(body.address);
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : undefined;
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter((v: unknown): v is string => typeof v === 'string') : undefined;
  const message = asString(body.message);
  const signature = asString(body.signature);

  if (!agentId) return NextResponse.json({ ok: false, error: 'agent_id_required' }, { status: 400 });
  if (!address || !isAddress(address)) return NextResponse.json({ ok: false, error: 'invalid_address' }, { status: 400 });
  if (endpoint && !(endpoint.startsWith('http://') || endpoint.startsWith('https://'))) {
    return NextResponse.json({ ok: false, error: 'invalid_endpoint' }, { status: 400 });
  }

  const allowUnsigned = process.env.A2A_ALLOW_UNSIGNED_EXTERNAL_REGISTRATION === 'true';
  if (!allowUnsigned && (!message || !signature)) {
    return NextResponse.json({ ok: false, error: 'signature_required' }, { status: 400 });
  }

  let signatureValid = false;
  if (message && signature) {
    try {
      const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
      signatureValid = getAddress(recovered) === getAddress(address);
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 401 });
  }

  const autoApprove = process.env.A2A_AUTO_APPROVE_EXTERNAL_AGENTS === 'true';
  const status = autoApprove && signatureValid ? 'approved' : 'pending';

  try {
    const entry = await registerExternalAgent({ agentId, address: getAddress(address), name, endpoint, capabilities, status });
    console.log(`[a2a] external agent registered agentId=${entry.agentId} status=${entry.status}`);
    return NextResponse.json({ ok: true, agent: entry });
  } catch (error) {
    if (error instanceof Error && error.message === 'duplicate_agent_id_different_address') {
      return NextResponse.json({ ok: false, error: 'duplicate_agent_id' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: 'registry_write_failed' }, { status: 500 });
  }
}
