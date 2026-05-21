import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/a2a/auth';
import { insertBridgeReceipt } from '@/lib/agent-bridge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RECEIPT_TYPES = new Set(['x402_arc_native', 'x402_circle_gateway', 'dry_run']);

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req, ['agent_bridge:write', 'agent_bridge:receipt']);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad('invalid_json');
  }

  const sessionId = String(body.sessionId ?? '').trim();
  const receiptType = String(body.receiptType ?? '').trim();
  if (!sessionId) return bad('missing_sessionId');
  if (!RECEIPT_TYPES.has(receiptType)) return bad('invalid_receiptType');

  try {
    const receipt = await insertBridgeReceipt({
      sessionId,
      receiptType: receiptType as Parameters<typeof insertBridgeReceipt>[0]['receiptType'],
      paymentId: typeof body.paymentId === 'string' ? body.paymentId : null,
      transaction: typeof body.transaction === 'string' ? body.transaction : null,
      payloadHash: typeof body.payloadHash === 'string' ? body.payloadHash : null,
      metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata as Record<string, unknown> : {},
    });
    return NextResponse.json({ ok: true, receiptId: receipt.id, agentId: auth.key.agentId });
  } catch (err) {
    return bad('insert_failed', 500, { message: err instanceof Error ? err.message : 'unknown' });
  }
}
