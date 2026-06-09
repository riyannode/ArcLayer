import { humanJson } from '@/lib/api/human-json';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Thin proxy -> arclayer-indexer service (PM2: arclayer-indexer, port 3535).
 *
 * The indexer service polls Arc Testnet RPC every 15s and caches events to
 * SQLite, so downstream calls are sub-100ms. Previously this route rebuilt
 * projections from RPC *per request* (~5-9s), causing cloudflared "context
 * canceled" + browser "Failed to fetch" on /agents and /dashboard.
 *
 * Path mapping: /api/indexer/<segments...> -> http://localhost:3535/<segments...>
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const INDEXER_INTERNAL_URL = process.env.INDEXER_INTERNAL_URL || 'http://localhost:3535';

function upstreamPath(request: NextRequest) {
  const raw = request.nextUrl.pathname.replace(/^\/api\/indexer\/?/, '');
  const qs = request.nextUrl.search || '';
  return raw ? `/${raw}${qs}` : `/${qs}`;
}

export async function GET(request: NextRequest) {
  const target = `${INDEXER_INTERNAL_URL}${upstreamPath(request)}`;

  try {
    const upstream = await fetch(target, {
      cache: 'no-store',
      // Short timeout so a stuck indexer surfaces fast instead of hanging the page.
      signal: AbortSignal.timeout(8000),
    });

    const body = await upstream.text();
    // Cache successful indexer reads at the edge for 10s with a 30s SWR window.
    // Indexer service polls Arc Testnet every 15s, so 10s edge cache is the
    // largest window that cannot serve stale-relative-to-source data, and SWR
    // smooths over upstream stalls without blocking renders.
    // Errors and non-2xx responses bypass the cache.
    const cacheControl = upstream.ok
      ? 'public, s-maxage=10, stale-while-revalidate=30'
      : 'no-store';
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'cache-control': cacheControl,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Indexer upstream unreachable.';
    return humanJson(request, { error: 'Indexer upstream unreachable.', detail: message, target }, { status: 502 });
  }
}
