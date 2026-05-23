import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

export const runtime = 'nodejs';

const DEFAULT_AMOUNT_ATOMIC = '1';

function parseAgentIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/api\/agents\/(\d+)\/run$/);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function POST(req: NextRequest) {
  const agentId = parseAgentIdFromPath(req.nextUrl.pathname);
  if (agentId === null) {
    return NextResponse.json({ ok: false, error: 'invalid_agent_id' }, { status: 400 });
  }

  const handler = withX402(async () => NextResponse.json({
    ok: true,
    agentId,
    run: {
      status: 'completed',
      output: `Agent ${agentId} run completed`,
      completedAt: Date.now(),
    },
    payment: {
      status: 'settled',
    },
  }), {
    amount: process.env.X402_AGENT_RUN_AMOUNT_ATOMIC || DEFAULT_AMOUNT_ATOMIC,
    resource: `/api/agents/${agentId}/run`,
    description: 'Run paid agent invocation',
  });

  return handler(req);
}
