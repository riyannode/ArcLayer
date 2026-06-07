/**
 * POST /api/mcp/signing-requests/[id]/submitted
 *
 * Stores txHash and moves signing → submitted.
 * Called by Profile modal after walletClient.sendTransaction succeeds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { markSubmitted } from '@/lib/mcp/signing-bridge/store';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = await req.json();
    const txHash = String(body.txHash || '').trim();
    if (!txHash || !txHash.startsWith('0x')) {
      return NextResponse.json({ ok: false, error: 'txHash required (0x-prefixed)' }, { status: 400 });
    }

    const ok = await markSubmitted(id, txHash);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: 'invalid_transition', detail: 'Request is not in signing status' },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'submit_failed' },
      { status: 500 },
    );
  }
}
