import { NextResponse } from 'next/server';
import {
  type AgentCharge,
  makePythiaSignalCharge,
  makeApoloDecisionCharge,
  makeHermesIntentCharge,
  bumpApoloReputation,
  getApoloReputation,
  shortHash,
  fetchLatestA2ARow,
} from '@/lib/a2a/x402-flow';

/**
 * POST /api/a2a/run-flow
 *
 * Runs ONE end-to-end A2A loop on demand and returns receipts for THREE
 * x402 charges in the agent flow:
 *
 *   1. Pythia charges Apolo  0.005 USDC for the BTC 5m signal
 *   2. Apolo  charges Hermes 0.010 USDC for the risk + edge decision
 *   3. Hermes charges Job    0.015 USDC for the execution intent / action proof
 *
 * Each charge produces a full x402 lifecycle proof: 402-required → X-PAYMENT
 * authorization → facilitator verify → USDC settlement → resource unlock →
 * receipt generated. The signal itself is real (proxied from
 * /api/a2a/live-signal). Settlement receipts are deterministic and durable
 * for the lifetime of the Node process.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FlowReceipt = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  charges: AgentCharge[];
  decision: {
    asset: string;
    decision: string;
    risk: string;
    confidence: number;
    status: 'APPROVED' | 'REJECTED';
  };
  hermesAction: {
    action: 'BUY_UP' | 'BUY_DOWN' | 'SKIP';
    sizeUsdc: string;
    mode: 'DRY_RUN';
  };
  agentReputation: {
    agent: 'Apolo';
    role: 'Decision Filter';
    delta: number;
    score: number;
    rationale: string;
  };
  signal: { asset: string; signal: string; confidence: number; payloadHash: string };
  error?: string;
};

export async function POST(req: Request) {
  const startedAt = new Date();
  try {
    const origin = new URL(req.url).origin;
    const row = await fetchLatestA2ARow(origin);

    const charges: AgentCharge[] = [
      makePythiaSignalCharge(),
      makeApoloDecisionCharge(),
      makeHermesIntentCharge(),
    ];

    const apoloApproved = row.apolo.status === 'APPROVED';
    const repDelta = apoloApproved ? 1 : 0;
    const repScore = bumpApoloReputation(repDelta);

    const signalPayload = {
      asset: row.asset,
      signal: row.ignia.rawSignal,
      confidence: row.ignia.confidence,
    };
    const payloadHash = shortHash(JSON.stringify(signalPayload));

    const finishedAt = new Date();
    const out: FlowReceipt = {
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      charges,
      decision: {
        asset: row.asset,
        decision: row.apolo.decision,
        risk: row.apolo.risk,
        confidence: row.apolo.confidence,
        status: row.apolo.status,
      },
      hermesAction: {
        action: row.hermes.action,
        sizeUsdc: row.hermes.sizeUsdc,
        mode: row.hermes.mode,
      },
      agentReputation: {
        agent: 'Apolo',
        role: 'Decision Filter',
        delta: repDelta,
        score: repScore,
        rationale: apoloApproved
          ? 'Apolo filtered the signal and approved an actionable decision'
          : 'Apolo rejected the signal — no reputation gained on rejected work',
      },
      signal: { ...signalPayload, payloadHash },
    };
    return NextResponse.json(out);
  } catch (err: any) {
    const finishedAt = new Date();
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || 'flow failed',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    method: 'POST',
    description: 'Runs one A2A loop. Returns 3 x402 charges (Pythia←Apolo, Apolo←Hermes, Hermes←Job) with full lifecycle.',
    apoloReputationScore: getApoloReputation(),
  });
}
