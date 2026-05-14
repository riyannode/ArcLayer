/**
 * In-memory per-IP sliding window rate limiter.
 * Stored on globalThis so it survives Next.js module hot-reloads within the same process.
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 10;

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
  store.forEach((entry, ip) => {
    if (entry.resetAt <= now) store.delete(ip);
  });
}

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetAt: number;
  /** milliseconds until the window resets (useful for Retry-After header) */
  retryAfterMs: number;
}

export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  maybeSweep(now);

  const existing = store.get(ip);

  if (!existing || existing.resetAt <= now) {
    const entry: RateLimitEntry = { count: 1, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
    return { limited: false, remaining: MAX_REQUESTS - 1, resetAt: entry.resetAt, retryAfterMs: 0 };
  }

  if (existing.count >= MAX_REQUESTS) {
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
    remaining: MAX_REQUESTS - existing.count,
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
