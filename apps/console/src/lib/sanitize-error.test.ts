import { describe, expect, it } from 'vitest';
import { sanitizeErrorMessage } from './sanitize-error';

describe('sanitizeErrorMessage', () => {
  it('returns a safe fallback for unknown values', () => {
    expect(sanitizeErrorMessage({ boom: true })).toBe('agent execution failed');
    expect(sanitizeErrorMessage(null)).toBe('agent execution failed');
  });

  it('keeps only the first line and strips stack traces', () => {
    const raw = new Error('agent_http_502: upstream failed\n    at runAgent (/root/ArcLayer/apps/console/src/lib/agentExecutor.ts:44:9)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)');
    const out = sanitizeErrorMessage(raw);
    expect(out).toContain('agent_http_502: upstream failed');
    expect(out).not.toContain('at runAgent');
    expect(out).not.toContain('processTicksAndRejections');
  });

  it('redacts bearer tokens and credentials', () => {
    const out = sanitizeErrorMessage(
      new Error("Authorization failed: Bearer TEST_BEARER_TOKEN token=TEST_CREDENTIAL api_key='TEST_API_KEY' password=TEST_PASSWORD")
    );
    expect(out).toContain('Bearer [redacted]');
    expect(out).toContain('[redacted-credential]');
    expect(out).not.toContain('TEST_BEARER_TOKEN');
    expect(out).not.toContain('TEST_CREDENTIAL');
    expect(out).not.toContain('TEST_API_KEY');
    expect(out).not.toContain('TEST_PASSWORD');
  });

  it('redacts standalone key prefixes', () => {
    const out = sanitizeErrorMessage(new Error('upstream rejected ksk_testkey12345 and pk_testkey67890'));
    expect(out).toContain('[redacted-key]');
    expect(out).not.toContain('ksk_testkey12345');
    expect(out).not.toContain('pk_testkey67890');
  });

  it('redacts absolute filesystem paths', () => {
    const out = sanitizeErrorMessage(
      new Error('9router failed at /root/ArcLayer/apps/console/src/lib/agentExecutor.ts:44 and /tmp/runtime/secret.txt')
    );
    expect(out).toContain('[path]');
    expect(out).not.toContain('/root/ArcLayer');
    expect(out).not.toContain('/tmp/runtime/secret.txt');
  });

  it('truncates very long messages', () => {
    const out = sanitizeErrorMessage(new Error('x'.repeat(500)));
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith('…')).toBe(true);
  });
});
