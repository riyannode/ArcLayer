/**
 * POST /api/mcp/signing-requests/[id]/confirmed
 *
 * Stores result jsonb and moves submitted → confirmed.
 * Called by Profile modal after all txs are confirmed on-chain.
 */

import { NextRequest, NextResponse } from 'next/server';
import { markConfirmed, type SigningRequestResult } from '@/lib/mcp/signing-bridge/store';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = await req.json();

    const result = body.result as SigningRequestResult | undefined;
    if (!result || !Array.isArray(result.txHashes) || !Array.isArray(result.receipts)) {
      return NextResponse.json(
        { ok: false, error: 'result must have txHashes[] and receipts[]' },
        { status: 400 },
      );
    }

    const ok = await markConfirmed(id, result);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: 'invalid_transition', detail: 'Request is not in submitted/signing status' },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'confirm_failed' },
      { status: 500 },
    );
  }
}
