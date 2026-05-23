import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

export const runtime = 'nodejs';

async function handler(req: NextRequest) {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idToken = parts[parts.length - 2];
  const agentId = Number.parseInt(idToken, 10);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid_agent_id' }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    agentId,
    run: {
      status: 'completed',
      output: `Agent ${agentId} execution completed`,
      completedAt: Date.now(),
    },
    payment: { status: 'settled' },
  });
}

export const POST = withX402(handler, {
  amount: process.env.X402_AGENT_RUN_AMOUNT_ATOMIC || '1',
  resource: '/api/agents/${agentId}/run',
  description: 'x402-protected agent run endpoint',
});
