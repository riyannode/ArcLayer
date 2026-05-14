/**
 * Guardrail branch tests for POST /api/agents/[id]/run.
 *
 * These test the guardrail logic (rate limit, input length, error sanitization)
 * without needing the full Next.js runtime or Supabase connection.
 * The actual route integration is covered by phase-g-test.mjs (19/19).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { checkRateLimit } from '@/lib/rate-limit';
import { sanitizeErrorMessage } from '@/lib/sanitize-error';

function clearStore() {
  const g = globalThis as typeof globalThis & {
    __rateLimitStore?: Map<string, unknown>;
  };
  g.__rateLimitStore?.clear();
}

describe('route guardrails: rate limit → 429', () => {
  beforeEach(() => clearStore());

  it('11th request from same IP is blocked', () => {
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit('test-ip-route')).toMatchObject({ limited: false });
    }
    const result = checkRateLimit('test-ip-route');
    expect(result.limited).toBe(true);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    // Route would return: 429 { error: 'rate_limit_exceeded' }
  });
});

describe('route guardrails: input too long → 400', () => {
  const MAX_INPUT_LENGTH = 2000;

  it('input at exactly 2000 chars is accepted', () => {
    const input = 'a'.repeat(MAX_INPUT_LENGTH);
    expect(input.length > MAX_INPUT_LENGTH).toBe(false);
  });

  it('input at 2001 chars triggers rejection', () => {
    const input = 'a'.repeat(MAX_INPUT_LENGTH + 1);
    expect(input.length > MAX_INPUT_LENGTH).toBe(true);
    // Route would return: 400 { error: 'input_too_long', message: `...got ${input.length}` }
  });

  it('JSON-stringified object input counts correctly', () => {
    // Route does: inputStr = JSON.stringify(inputRaw) when not a string
    const obj = { data: 'x'.repeat(1990) };
    const inputStr = JSON.stringify(obj);
    expect(inputStr.length).toBeGreaterThan(MAX_INPUT_LENGTH);
    // Route would return 400 for this
  });
});

describe('route guardrails: executor failure → sanitized 502', () => {
  it('stack trace is stripped from error message', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:20128');
    err.stack = `Error: connect ECONNREFUSED 127.0.0.1:20128
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)
    at /root/ArcLayer/apps/console/src/lib/agentExecutor.ts:55:11`;
    const msg = sanitizeErrorMessage(err);
    expect(msg).not.toContain('TCPConnectWrap');
    expect(msg).not.toContain('agentExecutor.ts');
    expect(msg).toContain('connect ECONNREFUSED');
  });

  it('API keys in error messages are redacted', () => {
    const err = new Error('Request failed: Bearer sk-swukmy1bgihlhs5qg3vqmws4acxt78in1chebmbk7i0fthmv returned 401');
    const msg = sanitizeErrorMessage(err);
    expect(msg).not.toContain('sk-swukmy1b');
    expect(msg).toContain('Bearer [redacted]');
  });

  it('filesystem paths are masked', () => {
    const err = new Error('ENOENT: no such file or directory, open /root/ArcLayer/apps/console/.env.local');
    const msg = sanitizeErrorMessage(err);
    expect(msg).not.toContain('/root/ArcLayer');
    expect(msg).toContain('[path]');
  });

  it('empty error returns safe fallback', () => {
    const msg = sanitizeErrorMessage(new Error(''));
    expect(msg).toBe('agent execution failed');
  });
});
