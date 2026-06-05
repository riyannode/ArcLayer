import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';
import type { AgentX402Rail } from '@/lib/x402/agent-payer';

export const runtime = 'nodejs';


const PREDICTION_BOT_NAMES: Record<string, string> = {
  '19803': 'ArcLayer Prediction Analyzer',
  '19804': 'ArcLayer Prediction Evaluator',
  '19805': 'ArcLayer Prediction Executor',
  '19806': 'ArcLayer Prediction Oracle',
};


function parseAgentId(req: NextRequest) {
  const parts = req.nextUrl.pathname.split('/').filter(Boolean);
  const idToken = parts[parts.length - 2];
  const agentId = Number.parseInt(idToken, 10);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    return null;
  }
  return agentId;
}

async function handler(req: NextRequest) {
  const agentId = parseAgentId(req);
  if (!agentId) {
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

export async function POST(req: NextRequest) {
  const agentId = parseAgentId(req);
  if (!agentId) {
    return NextResponse.json({ ok: false, error: 'invalid_agent_id' }, { status: 400 });
  }

  return withX402(handler, {
    amount: process.env.X402_AGENT_RUN_AMOUNT_ATOMIC || '1',
    resource: `/api/agents/${agentId}/run`,
    description: 'x402-protected agent run endpoint',
    liveAgentId: String(agentId),
    liveAgentName: PREDICTION_BOT_NAMES[String(agentId)] || `Agent ${agentId}`,
    allowedRails: ['circle-gateway-passkey'],
    agentPayerBinding: {
      required: true,
      rail: 'circle-gateway' as AgentX402Rail,
      getContext: async (req: NextRequest) => {
        const id = parseAgentId(req);
        return {
          agentId: String(id ?? agentId),
          runtimeId: req.headers.get('x-arclayer-runtime-id') || null,
          sessionId: null,
          jobId: null,
        };
      },
    },
  })(req);
}
