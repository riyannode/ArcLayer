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
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Indexer upstream unreachable.';
    return NextResponse.json(
      { error: 'Indexer upstream unreachable.', detail: message, target },
      { status: 502 },
    );
  }
}
