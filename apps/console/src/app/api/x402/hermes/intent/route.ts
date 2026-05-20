import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';
import {
  makeHermesIntentCharge,
  fetchLatestA2ARow,
  shortHash,
} from '@/lib/a2a/x402-flow';

/**
 * POST /api/x402/hermes/intent
 *
 * x402-gated Hermes execution intent endpoint. Buyer (typically a Job
 * contract or downstream executor) pays 0.000001 USDC and receives:
 *   - action (BUY_UP / BUY_DOWN / SKIP)
 *   - intent size in USDC
 *   - mode (DRY_RUN on testnet)
 *   - intent payload hash (commit-and-reveal anchor)
 *   - x402 charge receipt (Hermes → buyer) with full lifecycle proof
 *
 * Standalone counterpart to the Hermes leg inside /api/a2a/run-flow. Lets
 * external job runners purchase only the execution-intent step without
 * paying for upstream Pythia + Apolo charges.
 */

export const runtime = 'nodejs';

async function handler(req: NextRequest): Promise<NextResponse> {
  const startedAt = new Date();
  try {
    const origin = new URL(req.url).origin;
    const row = await fetchLatestA2ARow(origin);
    const charge = makeHermesIntentCharge();

    const intentPayload = {
      asset: row.asset,
      action: row.hermes.action as 'BUY_UP' | 'BUY_DOWN' | 'SKIP',
      sizeUsdc: row.hermes.sizeUsdc,
      mode: row.hermes.mode as 'DRY_RUN',
      sourceDecision: row.apolo.decision,
      sourceStatus: row.apolo.status,
    };
    const payloadHash = shortHash(JSON.stringify(intentPayload));

    const finishedAt = new Date();
    return NextResponse.json({
      ok: true,
      service: 'hermes-intent',
      paid: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      charge,
      intent: { ...intentPayload, payloadHash },
      window: row.window,
      slug: row.slug,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'hermes_intent_failed' },
      { status: 500 },
    );
  }
}

// 0.000001 USDC = 1 atomic (6 decimals)
export const POST = withX402(handler, {
  amount: '1',
  resource: '/api/x402/hermes/intent',
  description: 'Hermes execution intent — action + size + commit hash for downstream execution',
});
