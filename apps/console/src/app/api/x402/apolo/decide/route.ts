import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';
import {
  makeApoloDecisionCharge,
  fetchLatestA2ARow,
  shortHash,
} from '@/lib/a2a/x402-flow';

/**
 * POST /api/x402/apolo/decide
 *
 * x402-gated Apolo decision endpoint. Buyer pays 0.010 USDC and receives:
 *   - decision (UP/DOWN/NEUTRAL) + status (APPROVED/REJECTED)
 *   - risk classification + confidence
 *   - rationale string
 *   - x402 charge receipt with full lifecycle (Apolo → buyer)
 *
 * External agents (e.g. external Hermes implementation, third-party traders)
 * can call this directly without going through /api/a2a/run-flow. Reuses the
 * same shared a2a/x402-flow primitives so receipts are consistent.
 */

export const runtime = 'nodejs';

async function handler(req: NextRequest): Promise<NextResponse> {
  const startedAt = new Date();
  try {
    const origin = new URL(req.url).origin;
    const row = await fetchLatestA2ARow(origin);
    const charge = makeApoloDecisionCharge();

    const decisionPayload = {
      asset: row.asset,
      decision: row.apolo.decision,
      status: row.apolo.status,
      risk: row.apolo.risk,
      confidence: row.apolo.confidence,
      reason: row.apolo.reason,
    };
    const payloadHash = shortHash(JSON.stringify(decisionPayload));

    const finishedAt = new Date();
    return NextResponse.json({
      ok: true,
      service: 'apolo-decision',
      paid: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      charge,
      decision: { ...decisionPayload, payloadHash },
      window: row.window,
      slug: row.slug,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'apolo_decision_failed' },
      { status: 500 },
    );
  }
}

// 0.010 USDC = 10000 atomic (6 decimals)
export const POST = withX402(handler, {
  amount: '10000',
  resource: '/api/x402/apolo/decide',
  description: 'Apolo decision filter — risk gate + confidence over a fresh Pythia signal',
});
