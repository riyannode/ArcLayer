/**
 * safeFetch.ts — client-side fetch utilities that never crash on non-JSON responses.
 *
 * Pattern: res.text() → parse only if body exists → useful error message.
 * Replace bare res.json() calls in client components with safeJson<T>(res).
 */

export async function safeJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text || !text.trim()) {
    throw new Error(`Empty response (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.length > 200 ? text.slice(0, 200) + '…' : text;
    throw new Error(`Invalid JSON (HTTP ${res.status}): ${preview}`);
  }
}

/**
 * safeJsonCatch — same as safeJson but catches errors and returns a fallback.
 * Use for non-critical polling where a silent fallback is acceptable.
 */
export async function safeJsonCatch<T>(res: Response, fallback: T): Promise<T> {
  try {
    return await safeJson<T>(res);
  } catch {
    return fallback;
  }
}
