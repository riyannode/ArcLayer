type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const SWEEP_INTERVAL = 200;
let callsSinceSweep = 0;

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
  callsSinceSweep = 0;
}

export function checkMemoryRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();

  if (++callsSinceSweep >= SWEEP_INTERVAL) {
    sweepExpired(now);
  }

  const existing = buckets.get(input.key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + input.windowMs;
    buckets.set(input.key, {
      count: 1,
      resetAt,
    });

    return {
      ok: true,
      limit: input.limit,
      remaining: input.limit - 1,
      resetAt,
    };
  }

  if (existing.count >= input.limit) {
    return {
      ok: false,
      limit: input.limit,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  existing.count += 1;
  buckets.set(input.key, existing);

  return {
    ok: true,
    limit: input.limit,
    remaining: input.limit - existing.count,
    resetAt: existing.resetAt,
  };
}
