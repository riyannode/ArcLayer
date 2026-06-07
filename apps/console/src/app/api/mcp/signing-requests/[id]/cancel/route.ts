/**
 * POST /api/mcp/signing-requests/[id]/cancel
 *
 * Cancels a pending or signing request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cancelRequest } from '@/lib/mcp/signing-bridge/store';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const ok = await cancelRequest(id);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: 'invalid_transition', detail: 'Request cannot be cancelled from current status' },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'cancel_failed' },
      { status: 500 },
    );
  }
}
