import { describe, expect, it } from 'vitest';
import {
  createJobSchema,
  claimJobSchema,
  submitJobSchema,
  createWebhookSchema,
  createApiKeySchema,
} from './schemas';

describe('createJobSchema', () => {
  it('accepts valid input', () => {
    const r = createJobSchema.safeParse({ title: 'a', description: 'b' });
    expect(r.success).toBe(true);
  });

  it('rejects missing title', () => {
    const r = createJobSchema.safeParse({ description: 'b' });
    expect(r.success).toBe(false);
  });

  it('rejects oversize title', () => {
    const r = createJobSchema.safeParse({ title: 'a'.repeat(201), description: 'b' });
    expect(r.success).toBe(false);
  });
});

describe('createWebhookSchema', () => {
  it('accepts https URL', () => {
    const r = createWebhookSchema.safeParse({ url: 'https://example.com/hook' });
    expect(r.success).toBe(true);
  });

  it('rejects http URL', () => {
    const r = createWebhookSchema.safeParse({ url: 'http://example.com/hook' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid event names', () => {
    const r = createWebhookSchema.safeParse({
      url: 'https://example.com/hook',
      events: ['invalid.event'],
    });
    expect(r.success).toBe(false);
  });
});

describe('claimJobSchema', () => {
  it('accepts valid agentId', () => {
    expect(claimJobSchema.safeParse({ agentId: 'a' }).success).toBe(true);
  });

  it('rejects empty agentId', () => {
    expect(claimJobSchema.safeParse({ agentId: '' }).success).toBe(false);
  });
});

describe('submitJobSchema', () => {
  it('accepts arbitrary output', () => {
    const r = submitJobSchema.safeParse({
      agentId: 'a',
      output: { foo: 'bar' },
    });
    expect(r.success).toBe(true);
  });
});

describe('createApiKeySchema', () => {
  it('accepts valid input', () => {
    expect(createApiKeySchema.safeParse({ agentId: 'a' }).success).toBe(true);
  });

  it('accepts scopes array', () => {
    expect(
      createApiKeySchema.safeParse({ agentId: 'a', scopes: ['jobs:claim'] }).success,
    ).toBe(true);
  });
});
