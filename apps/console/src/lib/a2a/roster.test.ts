import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase client used by roster.ts
const fakeRows: Array<{ agent_id: string; manifest: unknown; updated_at: string }> = [];

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        order: () =>
          Promise.resolve({
            data: fakeRows,
            error: null,
          }),
      }),
    }),
  }),
}));

import { manifestToCandidate, listRosterCandidates } from './roster';
import type { AgentManifestV1 } from './manifest/types';

const baseManifest = (overrides: Partial<AgentManifestV1> = {}): AgentManifestV1 => ({
  schema: 'arclayer.agent/v1',
  version: 1,
  agentId: 'test-agent',
  name: 'Test Agent',
  role: 'trader',
  description: 'Test agent for roster',
  capability: ['execution'],
  categories: ['trading'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('manifestToCandidate', () => {
  it('maps basic manifest fields', () => {
    const m = baseManifest();
    const c = manifestToCandidate(m);
    expect(c.agentId).toBe('test-agent');
    expect(c.role).toBe('trader');
    expect(c.capability).toContain('execution');
    expect(c.categories).toContain('trading');
  });

  it('merges capability + capabilities + child role caps', () => {
    const m = baseManifest({
      capability: ['exec'],
      capabilities: ['signal'],
      roles: [
        { id: 'sub', name: 's', category: 'trading', capabilities: ['arb'] },
      ],
    });
    const c = manifestToCandidate(m);
    expect(c.capability).toEqual(expect.arrayContaining(['exec', 'signal', 'arb']));
  });

  it('includes child role categories', () => {
    const m = baseManifest({
      categories: ['trading'],
      roles: [
        { id: 'sub', name: 's', category: 'forecasting', capabilities: [] },
      ],
    });
    const c = manifestToCandidate(m);
    expect(c.categories).toEqual(expect.arrayContaining(['trading', 'forecasting']));
  });

  it('exposes roles[] for child-role matching', () => {
    const m = baseManifest({
      roles: [
        { id: 'sub-trade', name: 'Sub', category: 'trading', capabilities: ['exec'] },
      ],
    });
    const c = manifestToCandidate(m);
    expect(c.roles).toHaveLength(1);
    expect(c.roles?.[0].id).toBe('sub-trade');
  });

  it('preserves x402 enabled flag', () => {
    const m = baseManifest({ x402: { enabled: true } });
    const c = manifestToCandidate(m);
    expect(c.x402?.enabled).toBe(true);
  });
});

describe('listRosterCandidates', () => {
  beforeEach(() => {
    fakeRows.length = 0;
  });

  it('returns empty array when DB has no manifests', async () => {
    const out = await listRosterCandidates();
    expect(out).toEqual([]);
  });

  it('parses valid manifests into candidates', async () => {
    const m = baseManifest({ agentId: 'foo' });
    fakeRows.push({
      agent_id: 'foo',
      manifest: m,
      updated_at: '2026-01-01T00:00:00Z',
    });
    const out = await listRosterCandidates();
    expect(out).toHaveLength(1);
    expect(out[0].agentId).toBe('foo');
  });

  it('skips invalid manifests', async () => {
    fakeRows.push({
      agent_id: 'bad',
      manifest: { not: 'a manifest' },
      updated_at: '2026-01-01T00:00:00Z',
    });
    fakeRows.push({
      agent_id: 'good',
      manifest: baseManifest({ agentId: 'good' }),
      updated_at: '2026-01-01T00:00:00Z',
    });
    const out = await listRosterCandidates();
    expect(out).toHaveLength(1);
    expect(out[0].agentId).toBe('good');
  });
});
