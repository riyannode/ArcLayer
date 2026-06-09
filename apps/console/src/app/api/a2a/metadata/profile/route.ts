import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { getAgentsByController } from '@/lib/a2a/metadata-drafts/store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isAddress(value: unknown) {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('controller');

  if (!isAddress(raw)) {
    return humanJson(req, { ok: false, error: 'controller must be a valid wallet address (0x...)' }, { status: 400 });
  }

  const controller = raw as string;
  const agents = await getAgentsByController(controller);

  return humanJson(req, {
    ok: true,
    controller: controller.toLowerCase(),
    agents: agents.map((a) => ({
      agentId: a.agentId,
      controller: a.controller,
      status: a.status,
      txHash: a.txHash,
      metadata: a.metadata,
      updatedAt: a.updatedAt,
    })),
    total: agents.length,
  });
}
