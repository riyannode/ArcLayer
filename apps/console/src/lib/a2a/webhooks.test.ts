import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from './webhooks';

describe('webhook signing', () => {
  it('signs payload deterministically', () => {
    const payload = JSON.stringify({ event: 'job.submitted', id: 'job_1' });
    const sig1 = signPayload(payload, 'whsec_test');
    const sig2 = signPayload(payload, 'whsec_test');
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('verifies valid signatures', () => {
    const payload = JSON.stringify({ ok: true });
    const sig = signPayload(payload, 'whsec_test');
    expect(verifySignature(payload, 'whsec_test', sig)).toBe(true);
  });

  it('rejects invalid signatures', () => {
    const payload = JSON.stringify({ ok: true });
    const sig = signPayload(payload, 'whsec_test');
    expect(verifySignature(payload, 'wrong_secret', sig)).toBe(false);
    expect(verifySignature(payload + 'x', 'whsec_test', sig)).toBe(false);
  });
});
