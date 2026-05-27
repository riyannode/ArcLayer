/**
 * safeNumber.ts — BigInt/Number helpers that never throw on null/undefined/invalid input.
 * Use in UI render paths that parse API/indexer values.
 */

/**
 * Safely parse a value to BigInt. Returns fallback on null, undefined, empty string, or NaN.
 *
 * @param value - raw value from API/indexer response
 * @param fallback - default bigint to return when value is invalid (default 0n)
 */
export function safeBigInt(
  value: string | number | bigint | null | undefined,
  fallback: bigint = 0n
): bigint {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback;
    return BigInt(Math.floor(value));
  }
  const trimmed = (value as string).trim();
  if (!trimmed) return fallback;
  try {
    return BigInt(trimmed);
  } catch {
    return fallback;
  }
}
