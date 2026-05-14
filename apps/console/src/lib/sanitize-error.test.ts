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
      new Error("Authorization failed: Bearer sk-secretsecret123 token=abcdefghi12345 api_key='ksk_supersecret999' password=hunter2")
    );
    expect(out).toContain('Bearer [redacted]');
    expect(out).toContain('[redacted-credential]');
    expect(out).not.toContain('sk-secretsecret123');
    expect(out).not.toContain('abcdefghi12345');
    expect(out).not.toContain('ksk_supersecret999');
    expect(out).not.toContain('hunter2');
  });

  it('redacts standalone key prefixes', () => {
    const out = sanitizeErrorMessage(new Error('upstream rejected ksk_supersecret999 and pk_anothersecret999'));
    expect(out).toContain('[redacted-key]');
    expect(out).not.toContain('ksk_supersecret999');
    expect(out).not.toContain('pk_anothersecret999');
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
