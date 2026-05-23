import { NextResponse } from 'next/server';
import { latestBridgeSession } from '@/lib/agent-bridge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const LATEST_SESSION_TTL_MS = 30_000;
const LATEST_SESSION_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';
let latestSessionCache: { expiresAt: number; payload: unknown } | null = null;

export async function GET() {
  try {
    if (latestSessionCache && latestSessionCache.expiresAt > Date.now()) {
      return NextResponse.json(latestSessionCache.payload, {
        headers: { 'Cache-Control': LATEST_SESSION_CACHE_CONTROL },
      });
    }
    const session = await latestBridgeSession();
    const payload = { ok: true, session };
    latestSessionCache = { expiresAt: Date.now() + LATEST_SESSION_TTL_MS, payload };
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': LATEST_SESSION_CACHE_CONTROL },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'query_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500, headers: { 'Cache-Control': LATEST_SESSION_CACHE_CONTROL } },
    );
  }
}
