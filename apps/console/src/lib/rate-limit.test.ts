import { describe, expect, it, beforeEach } from 'vitest';
import { checkRateLimit, getClientIp, applyRateLimit } from './rate-limit';

// Reset the in-memory store between tests by clearing globalThis.__rateLimitStore
function clearStore() {
  const g = globalThis as typeof globalThis & {
    __rateLimitStore?: Map<string, unknown>;
  };
  g.__rateLimitStore?.clear();
}

describe('checkRateLimit', () => {
  beforeEach(() => clearStore());

  it('allows first request and returns remaining = MAX-1', () => {
    const result = checkRateLimit('1.2.3.4');
    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(9);
    expect(result.retryAfterMs).toBe(0);
  });

  it('allows up to 10 requests within the window', () => {
    for (let i = 0; i < 10; i++) {
      const r = checkRateLimit('10.0.0.1');
      expect(r.limited).toBe(false);
    }
  });

  it('blocks the 11th request with limited=true', () => {
    for (let i = 0; i < 10; i++) checkRateLimit('10.0.0.2');
    const r = checkRateLimit('10.0.0.2');
    expect(r.limited).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('returns 429-ready fields: resetAt is a future timestamp', () => {
    for (let i = 0; i < 10; i++) checkRateLimit('10.0.0.3');
    const r = checkRateLimit('10.0.0.3');
    expect(r.resetAt).toBeGreaterThan(Date.now());
  });

  it('does not cross-contaminate different IPs', () => {
    for (let i = 0; i < 10; i++) checkRateLimit('192.168.1.1');
    const blocked = checkRateLimit('192.168.1.1');
    const allowed = checkRateLimit('192.168.1.2');
    expect(blocked.limited).toBe(true);
    expect(allowed.limited).toBe(false);
  });

  it('resets after window expires', () => {
    const g = globalThis as typeof globalThis & {
      __rateLimitStore?: Map<string, { count: number; resetAt: number }>;
    };
    // Exhaust the limit
    for (let i = 0; i < 10; i++) checkRateLimit('10.0.0.4');
    // Manually expire the window
    const entry = g.__rateLimitStore?.get('10.0.0.4');
    if (entry) entry.resetAt = Date.now() - 1;
    // Next call should start a fresh window
    const r = checkRateLimit('10.0.0.4');
    expect(r.limited).toBe(false);
    expect(r.remaining).toBe(9);
  });
});

describe('getClientIp', () => {
  function makeReq(headers: Record<string, string>) {
    return { headers: { get: (k: string) => headers[k] ?? null } };
  }

  it('reads x-forwarded-for first', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1');
  });

  it('falls back to x-real-ip', () => {
    expect(getClientIp(makeReq({ 'x-real-ip': '3.3.3.3' }))).toBe('3.3.3.3');
  });

  it('falls back to x-vercel-forwarded-for', () => {
    expect(getClientIp(makeReq({ 'x-vercel-forwarded-for': '4.4.4.4, 5.5.5.5' }))).toBe('4.4.4.4');
  });

  it('returns "unknown" when no IP header present', () => {
    expect(getClientIp(makeReq({}))).toBe('unknown');
  });
});

describe('applyRateLimit', () => {
  beforeEach(() => clearStore());

  function makeReq(ip = '9.9.9.9') {
    return { headers: { get: (k: string) => (k === 'x-forwarded-for' ? ip : null) } };
  }

  it('returns null when within limits', () => {
    const result = applyRateLimit(makeReq(), 'test:scope', { max: 3 });
    expect(result).toBeNull();
  });

  it('returns 429 NextResponse when limit exceeded', () => {
    for (let i = 0; i < 3; i++) applyRateLimit(makeReq('8.8.8.8'), 'test:block', { max: 3 });
    const result = applyRateLimit(makeReq('8.8.8.8'), 'test:block', { max: 3 });
    expect(result).not.toBeNull();
    expect(result?.status).toBe(429);
  });

  it('uses agentId as key when provided', () => {
    // Exhaust limit for agent-a
    for (let i = 0; i < 2; i++) applyRateLimit(makeReq(), 'test:agent', { max: 2, agentId: 'agent-a' });
    const blockedA = applyRateLimit(makeReq(), 'test:agent', { max: 2, agentId: 'agent-a' });
    const allowedB = applyRateLimit(makeReq(), 'test:agent', { max: 2, agentId: 'agent-b' });
    expect(blockedA).not.toBeNull();
    expect(allowedB).toBeNull();
  });

  it('respects custom windowMs', () => {
    for (let i = 0; i < 5; i++) applyRateLimit(makeReq('7.7.7.7'), 'test:win', { max: 5, windowMs: 1000 });
    const result = applyRateLimit(makeReq('7.7.7.7'), 'test:win', { max: 5, windowMs: 1000 });
    expect(result).not.toBeNull();
  });
});
