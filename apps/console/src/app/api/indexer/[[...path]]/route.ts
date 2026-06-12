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
 * Response metadata:
 *   Object responses (health, overview, job/:id, agent/:id) → _meta in body
 *   Array responses (jobs, agents, proofs) → x-indexer-* headers only
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

// ── Response metadata helpers ──────────────────────────────────────────────

type ProviderMeta = {
  provider: 'custom' | 'goldsky' | 'custom-fallback';
  scope: IndexerScope;
  fallbackActive: boolean;
};

function buildMeta(provider: ProviderMeta['provider'], fallbackActive = false): ProviderMeta {
  return { provider, scope: INDEXER_SCOPE, fallbackActive };
}

/** Apply provider metadata as response headers (for array responses). */
function applyMetaHeaders(headers: Headers, m: ProviderMeta): void {
  headers.set('x-indexer-provider', m.provider);
  headers.set('x-indexer-scope', m.scope);
  headers.set('x-indexer-fallback-active', String(m.fallbackActive));
}

/**
 * Create a JSON response. For objects, _meta is injected into body.
 * For arrays, metadata goes in x-indexer-* headers only.
 */
function jsonResponse(
  data: unknown,
  m: ProviderMeta,
  init?: ResponseInit,
): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  applyMetaHeaders(headers, m);

  if (Array.isArray(data)) {
    // Array → preserve shape exactly, metadata in headers only
    return new NextResponse(JSON.stringify(data), {
      ...init,
      headers,
    });
  }

  // Object → inject _meta into body
  const enriched = { ...(data as Record<string, unknown>), _meta: m };
  return new NextResponse(JSON.stringify(enriched, null, 2), {
    ...init,
    headers,
  });
}

// ── Path parsing ───────────────────────────────────────────────────────────

/** Strip ERC-8004 source prefix from agent ID. "erc8004_identity_registry:42" → "42". */
export function toRawGoldskyAgentId(input: string): string {
  const decoded = decodeURIComponent(input).trim();
  if (!decoded) return decoded;
  const parts = decoded.split(':');
  return parts[parts.length - 1] || decoded;
}

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
  const m = buildMeta(providerLabel, fallbackActive);

  try {
    const upstream = await fetch(target, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    const body = await upstream.text();
    const cacheControl = upstream.ok
      ? 'public, s-maxage=10, stale-while-revalidate=30'
      : 'no-store';

    const headers = new Headers({
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': cacheControl,
    });
    applyMetaHeaders(headers, m);

    // PM2 body is passed through exactly — no transformation
    return new NextResponse(body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Indexer upstream unreachable.';
    return humanJson(request, {
      error: 'Indexer upstream unreachable.',
      detail: message,
      target,
      _meta: m,
    }, { status: 502 });
  }
}

// ── Goldsky reader routing ─────────────────────────────────────────────────

async function handleGoldskyRequest(request: NextRequest): Promise<NextResponse> {
  const path = parseIndexerPath(request);
  const m = buildMeta('goldsky');

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

  // ── Health (object → _meta in body) ──────────────────────────────────
  if (path === '/health') {
    const health = await readGoldskyHealth();
    return jsonResponse(health, m);
  }

  // ── Overview (object → _meta in body) ────────────────────────────────
  if (path === '/overview') {
    const overview = await readGoldskyOverview();
    const normalized = normalizeOverview(overview as unknown as Record<string, unknown>);
    return jsonResponse(normalized, m);
  }

  if (path === '/overview/summary') {
    const overview = await readGoldskyOverview();
    const normalized = normalizeOverview(overview as unknown as Record<string, unknown>);
    return jsonResponse(normalized.summary, m);
  }

  // ── Jobs (array → metadata in headers only) ──────────────────────────
  if (path === '/jobs') {
    const jobs = await readGoldskyJobs();
    const normalized = jobs.map((j) => normalizeJob(j as unknown as Record<string, unknown>));
    return jsonResponse(normalized, m);
  }

  // ── Job detail (object → _meta in body) ──────────────────────────────
  if (path.startsWith('/jobs/')) {
    const jobId = path.replace('/jobs/', '');
    if (!/^\d+$/.test(jobId)) {
      return jsonResponse({ error: 'Invalid job id.' }, m, { status: 400 });
    }
    const detail = await readGoldskyJobDetail(jobId);
    if (!detail) {
      return jsonResponse({ error: 'Job not found.' }, m, { status: 404 });
    }
    const normalized = normalizeJobDetail(detail as unknown as Record<string, unknown>);
    return jsonResponse(normalized, m);
  }

  // ── Agents (array → metadata in headers only) ────────────────────────
  if (path === '/agents') {
    const agents = await readGoldskyAgents();
    const normalized = agents.map((a) => normalizeAgent(a as unknown as Record<string, unknown>));
    return jsonResponse(normalized, m);
  }

  // ── Agent detail (object → _meta in body) ────────────────────────────
  if (path.startsWith('/agents/')) {
    const requestedAgentId = decodeURIComponent(path.replace('/agents/', ''));
    const agentId = toRawGoldskyAgentId(requestedAgentId);

    if (!agentId.trim()) {
      return jsonResponse({ error: 'Invalid agent id.' }, m, { status: 400 });
    }

    const detail = await readGoldskyAgentDetail(agentId);
    if (!detail) {
      return jsonResponse({ error: 'Agent not found.' }, m, { status: 404 });
    }
    const normalized = normalizeAgentDetail(detail as unknown as Record<string, unknown>);
    return jsonResponse(normalized, m);
  }

  // ── Proofs (array → metadata in headers only) ────────────────────────
  if (path === '/proofs') {
    const proofs = await readGoldskyProofs();
    return jsonResponse(proofs, m);
  }

  // ── Unsupported path ─────────────────────────────────────────────────
  return jsonResponse({ error: `Unsupported indexer path: ${path}` }, m, { status: 404 });
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
    return jsonResponse(
      { error: 'Goldsky indexer unavailable.', detail: errorMessage },
      buildMeta('goldsky'),
      { status: 502 },
    );
  }
}
