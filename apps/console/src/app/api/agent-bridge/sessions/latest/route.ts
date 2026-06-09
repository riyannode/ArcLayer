import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { latestBridgeSession } from '@/lib/agent-bridge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const LATEST_SESSION_TTL_MS = 30_000;
const LATEST_SESSION_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=120';
let latestSessionCache: { expiresAt: number; payload: unknown } | null = null;

export async function GET(req: NextRequest) {
  try {
    if (latestSessionCache && latestSessionCache.expiresAt > Date.now()) {
      return humanJson(req, latestSessionCache.payload, {
        headers: { 'Cache-Control': LATEST_SESSION_CACHE_CONTROL },
      });
    }
    const session = await latestBridgeSession();
    const payload = { ok: true, session };
    latestSessionCache = { expiresAt: Date.now() + LATEST_SESSION_TTL_MS, payload };
    return humanJson(req, payload, {
      headers: { 'Cache-Control': LATEST_SESSION_CACHE_CONTROL },
    });
  } catch (err) {
    return humanJson(req, { ok: false, error: 'query_failed', message: err instanceof Error ? err.message : 'unknown' }, { status: 500, headers: { 'Cache-Control': LATEST_SESSION_CACHE_CONTROL } });
  }
}
