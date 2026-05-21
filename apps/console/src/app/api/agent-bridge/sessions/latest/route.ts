import { NextResponse } from 'next/server';
import { latestBridgeSession } from '@/lib/agent-bridge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await latestBridgeSession();
    return NextResponse.json({ ok: true, session });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'query_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
