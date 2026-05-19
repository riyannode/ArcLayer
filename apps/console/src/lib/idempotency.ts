import { NextRequest, NextResponse } from 'next/server';

/**
 * In-memory idempotency store.
 * Key: Idempotency-Key header value
 * Value: { response, expiresAt }
 *
 * Production upgrade: move to Redis/Supabase for multi-instance.
 */
const store = new Map<string, { body: string; status: number; expiresAt: number }>();

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 10_000;

function cleanup() {
  if (store.size < MAX_ENTRIES) return;
  const now = Date.now();
  store.forEach((val, key) => {
    if (val.expiresAt < now) store.delete(key);
  });
}

/**
 * Check idempotency key. Returns cached response if exists, null otherwise.
 */
export function checkIdempotency(req: NextRequest): NextResponse | null {
  const key = req.headers.get('idempotency-key');
  if (!key) return null;

  const cached = store.get(key);
  if (!cached) return null;

  if (cached.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }

  return new NextResponse(cached.body, {
    status: cached.status,
    headers: {
      'content-type': 'application/json',
      'x-idempotent-replay': 'true',
    },
  });
}

/**
 * Store response for idempotency replay.
 */
export function storeIdempotency(req: NextRequest, response: NextResponse): void {
  const key = req.headers.get('idempotency-key');
  if (!key) return;

  cleanup();

  response.clone().text().then((body) => {
    store.set(key, {
      body,
      status: response.status,
      expiresAt: Date.now() + TTL_MS,
    });
  }).catch(() => {});
}
