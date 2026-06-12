import { humanJson } from '@/lib/api/human-json';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Indexer API route with server-side provider routing.
 *
 * Routing behavior:
 *   INDEXER_PROVIDER=custom (or unset) → PM2/SQLite proxy at INDEXER_INTERNAL_URL
 *   INDEXER_PROVIDER=goldsky           → Goldsky Supabase reader (server-only)
 *
 * Fallback behavior:
 *   If Goldsky reader fails and INDEXER_FALLBACK_URL is set → proxy to fallback
 *   If Goldsky reader fails and no fallback → 502 JSON error
 *
 * Security:
 *   - Provider selection uses server env ONLY (process.env.INDEXER_PROVIDER)
 *   - NEVER reads NEXT_PUBLIC_INDEXER_PROVIDER or NEXT_PUBLIC_INDEXER_SCOPE
 *   - Goldsky reader remains server-only (uses Supabase service_role key)
 *   - Raw Supabase rows are never exposed to the client
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── Server-only env reads (NEVER NEXT_PUBLIC_*) ────────────────────────────

type IndexerProvider = 'custom' | 'goldsky';
type IndexerScope = 'arclayer' | 'arcnetwork';

const INDEXER_PROVIDER: IndexerProvider =
  process.env.INDEXER_PROVIDER === 'goldsky' ? 'goldsky' : 'custom';

const INDEXER_SCOPE: IndexerScope =
  process.env.INDEXER_SCOPE === 'arcnetwork' ? 'arcnetwork' : 'arclayer';

const INDEXER_INTERNAL_URL = process.env.INDEXER_INTERNAL_URL || 'http://localhost:3535';
const INDEXER_FALLBACK_URL = process.env.INDEXER_FALLBACK_URL || '';

// ── Response metadata ──────────────────────────────────────────────────────

type ProviderMeta = {
  provider: 'custom' | 'goldsky' | 'custom-fallback';
  scope: IndexerScope;
  fallbackActive: boolean;
};

function meta(provider: ProviderMeta['provider'], fallbackActive = false): ProviderMeta {
  return { provider, scope: INDEXER_SCOPE, fallbackActive };
}

/** Wrap a JSON body with provider metadata. */
function withMeta<T>(data: T, providerMeta: ProviderMeta): T & { _meta: ProviderMeta } {
  return { ...data, _meta: providerMeta };
}

// ── Path parsing ───────────────────────────────────────────────────────────

function parseIndexerPath(request: NextRequest): string {
  const raw = request.nextUrl.pathname.replace(/^\/api\/indexer\/?/, '');
  return raw ? `/${raw}` : '/';
}

function upstreamPath(request: NextRequest) {
  const raw = request.nextUrl.pathname.replace(/^\/api\/indexer\/?/, '');
  const qs = request.nextUrl.search || '';
  return raw ? `/${raw}${qs}` : `/${qs}`;
}

// ── PM2/SQLite proxy (existing behavior) ───────────────────────────────────

async function proxyToPm2(
  request: NextRequest,
  targetUrl: string,
  providerLabel: 'custom' | 'custom-fallback',
  fallbackActive: boolean,
): Promise<NextResponse> {
  const target = `${targetUrl}${upstreamPath(request)}`;

  try {
    const upstream = await fetch(target, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    const body = await upstream.text();
    const cacheControl = upstream.ok
      ? 'public, s-maxage=10, stale-while-revalidate=30'
      : 'no-store';

    // Try to inject metadata into JSON responses
    if (upstream.ok && upstream.headers.get('content-type')?.includes('application/json')) {
      try {
        const parsed = JSON.parse(body);
        const enriched = withMeta(parsed, meta(providerLabel, fallbackActive));
        return new NextResponse(JSON.stringify(enriched, null, 2), {
          status: upstream.status,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': cacheControl,
          },
        });
      } catch {
        // Not valid JSON — return raw body
      }
    }

    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'cache-control': cacheControl,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Indexer upstream unreachable.';
    return humanJson(request, {
      error: 'Indexer upstream unreachable.',
      detail: message,
      target,
      _meta: meta(providerLabel, fallbackActive),
    }, { status: 502 });
  }
}

// ── Goldsky reader routing ─────────────────────────────────────────────────

async function handleGoldskyRequest(request: NextRequest): Promise<NextResponse> {
  const path = parseIndexerPath(request);

  // Dynamic import to keep Goldsky reader server-only
  const {
    readGoldskyHealth,
    readGoldskyOverview,
    readGoldskyJobs,
    readGoldskyJobDetail,
    readGoldskyAgents,
    readGoldskyAgentDetail,
    readGoldskyProofs,
  } = await import('@/lib/goldsky-supabase-indexer');

  const {
    normalizeJob,
    normalizeAgent,
    normalizeOverview,
    normalizeJobDetail,
    normalizeAgentDetail,
  } = await import('@/lib/indexer-response-normalizer');

  // Route to the correct reader function
  if (path === '/health') {
    const health = await readGoldskyHealth();
    return humanJson(request, withMeta(health, meta('goldsky')));
  }

  if (path === '/overview') {
    const overview = await readGoldskyOverview();
    const normalized = normalizeOverview(overview as unknown as Record<string, unknown>);
    return humanJson(request, withMeta(normalized, meta('goldsky')));
  }

  if (path === '/overview/summary') {
    const overview = await readGoldskyOverview();
    const normalized = normalizeOverview(overview as unknown as Record<string, unknown>);
    return humanJson(request, withMeta(normalized.summary, meta('goldsky')));
  }

  if (path === '/jobs') {
    const jobs = await readGoldskyJobs();
    const normalized = jobs.map((j) => normalizeJob(j as unknown as Record<string, unknown>));
    return humanJson(request, withMeta(normalized, meta('goldsky')));
  }

  if (path.startsWith('/jobs/')) {
    const jobId = path.replace('/jobs/', '');
    if (!/^\d+$/.test(jobId)) {
      return humanJson(request, { error: 'Invalid job id.', _meta: meta('goldsky') }, { status: 400 });
    }
    const detail = await readGoldskyJobDetail(jobId);
    if (!detail) {
      return humanJson(request, { error: 'Job not found.', _meta: meta('goldsky') }, { status: 404 });
    }
    const normalized = normalizeJobDetail(detail as unknown as Record<string, unknown>);
    return humanJson(request, withMeta(normalized, meta('goldsky')));
  }

  if (path === '/agents') {
    const agents = await readGoldskyAgents();
    const normalized = agents.map((a) => normalizeAgent(a as unknown as Record<string, unknown>));
    return humanJson(request, withMeta(normalized, meta('goldsky')));
  }

  if (path.startsWith('/agents/')) {
    const agentId = decodeURIComponent(path.replace('/agents/', ''));
    if (!agentId.trim()) {
      return humanJson(request, { error: 'Invalid agent id.', _meta: meta('goldsky') }, { status: 400 });
    }
    const detail = await readGoldskyAgentDetail(agentId);
    if (!detail) {
      return humanJson(request, { error: 'Agent not found.', _meta: meta('goldsky') }, { status: 404 });
    }
    const normalized = normalizeAgentDetail(detail as unknown as Record<string, unknown>);
    return humanJson(request, withMeta(normalized, meta('goldsky')));
  }

  if (path === '/proofs') {
    const proofs = await readGoldskyProofs();
    return humanJson(request, withMeta(proofs, meta('goldsky')));
  }

  // Unsupported path — return consistent 404
  return humanJson(request, {
    error: `Unsupported indexer path: ${path}`,
    _meta: meta('goldsky'),
  }, { status: 404 });
}

// ── Main GET handler ───────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // ── Custom provider (default) — existing PM2 proxy behavior ──────────
  if (INDEXER_PROVIDER === 'custom') {
    return proxyToPm2(request, INDEXER_INTERNAL_URL, 'custom', false);
  }

  // ── Goldsky provider ─────────────────────────────────────────────────
  try {
    return await handleGoldskyRequest(request);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Goldsky reader failed.';

    // Fallback to PM2/custom if configured
    if (INDEXER_FALLBACK_URL) {
      console.warn(`[indexer] Goldsky reader failed, falling back to ${INDEXER_FALLBACK_URL}: ${errorMessage}`);
      return proxyToPm2(request, INDEXER_FALLBACK_URL, 'custom-fallback', true);
    }

    // No fallback — return 502
    return humanJson(request, {
      error: 'Goldsky indexer unavailable.',
      detail: errorMessage,
      _meta: meta('goldsky'),
    }, { status: 502 });
  }
}
