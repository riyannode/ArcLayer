const buckets = new Map<string, { count: number; resetAt: number }>();
export function allowOAuthRequest(key: string, limit = 30, windowMs = 60_000): boolean {
  const now = Date.now(); const current = buckets.get(key);
  if (!current || current.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return true; }
  if (current.count >= limit) return false; current.count += 1; return true;
}
