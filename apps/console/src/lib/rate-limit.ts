/**
 * In-memory per-key sliding window rate limiter.
 * Stored on globalThis so it survives Next.js module hot-reloads within the same process.
 *
 * Phase 12: Extended to support configurable limits per route/scope and
 * composite keys (IP + agentId) for authenticated endpoints.
 */

import { NextResponse } from 'next/server';

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 10;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = ((globalThis as typeof globalThis & {
  __rateLimitStore?: Map<string, RateLimitEntry>;
}).__rateLimitStore ??= new Map<string, RateLimitEntry>());

// Sweep dead entries every 5 minutes to prevent unbounded memory growth.
let lastSweep = Date.now();
function maybeSweep(now: number): void {
  if (now - lastSweep < 5 * 60_000) return;
  lastSweep = now;
  store.forEach((entry, key) => {
    if (entry.resetAt <= now) store.delete(key);
  });
}

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetAt: number;
  /** milliseconds until the window resets (useful for Retry-After header) */
  retryAfterMs: number;
}

export interface RateLimitOptions {
  /** Max requests per window (default: 10) */
  max?: number;
  /** Window duration in ms (default: 60_000) */
  windowMs?: number;
}

export function checkRateLimit(key: string, opts?: RateLimitOptions): RateLimitResult {
  const maxReqs = opts?.max ?? DEFAULT_MAX_REQUESTS;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const now = Date.now();
  maybeSweep(now);

  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const entry: RateLimitEntry = { count: 1, resetAt: now + windowMs };
    store.set(key, entry);
    return { limited: false, remaining: maxReqs - 1, resetAt: entry.resetAt, retryAfterMs: 0 };
  }

  if (existing.count >= maxReqs) {
    return {
      limited: true,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterMs: existing.resetAt - now,
    };
  }

  existing.count += 1;
  return {
    limited: false,
    remaining: maxReqs - existing.count,
    resetAt: existing.resetAt,
    retryAfterMs: 0,
  };
}

export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip')?.trim() ??
    req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

// ─── Convenience: rate-limit response helper ──────────────────────────────────

/**
 * Check rate limit and return a 429 NextResponse if exceeded.
 * Returns null if within limits.
 *
 * Usage:
 *   const limited = applyRateLimit(req, 'a2a:jobs:create', { max: 5 });
 *   if (limited) return limited;
 */
export function applyRateLimit(
  req: { headers: { get(name: string): string | null } },
  scope: string,
  opts?: RateLimitOptions & { agentId?: string },
): NextResponse | null {
  const ip = getClientIp(req);
  // Composite key: scope + IP + optional agentId for per-agent limiting
  const key = opts?.agentId ? `${scope}:${opts.agentId}` : `${scope}:${ip}`;

  const result = checkRateLimit(key, opts);
  if (!result.limited) return null;

  return NextResponse.json(
    {
      ok: false,
      error: 'rate_limited',
      retryAfterMs: result.retryAfterMs,
      resetAt: result.resetAt,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(result.resetAt),
      },
    },
  );
}
