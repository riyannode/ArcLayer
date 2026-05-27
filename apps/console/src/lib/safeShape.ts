/**
 * safeShape.ts — lightweight runtime shape guards for frontend API/indexer responses.
 *
 * Use after safeJson/safeJsonCatch to normalize fields that may be valid JSON
 * but have unexpected shape (undefined instead of array, null instead of string).
 *
 * Never call .map/.filter/.toLowerCase on unknown API fields without these guards.
 */
export function asArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? value : fallback;
}

export function asRecord(
  value: unknown,
  fallback: Record<string, unknown> = {}
): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fallback;
}

export function asString(value: unknown, fallback: string = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback: number = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
