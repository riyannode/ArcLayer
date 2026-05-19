import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must use vi.hoisted so the mock fn exists before vi.mock factory runs
const mockReadContract = vi.hoisted(() => vi.fn());

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: () => ({ readContract: mockReadContract }),
    http: () => ({}),
  };
});

vi.mock('@arclayer/sdk', () => ({
  arcTestnet: { id: 70_701, name: 'Arc Testnet' },
}));

import {
  getReputationScore,
  getAgentStats,
  batchGetReputationScores,
  reputationBoost,
  agentIdToBytes32,
  rankAgentsWithReputation,
} from './reputation';

describe('reputationBoost', () => {
  it('returns 0 for non-positive scores', () => {
    expect(reputationBoost(0n)).toBe(0);
    expect(reputationBoost(-50n)).toBe(0);
  });

  it('scales linearly up to 30', () => {
    expect(reputationBoost(100n)).toBe(10);
    expect(reputationBoost(200n)).toBe(20);
    expect(reputationBoost(300n)).toBe(30);
  });

  it('caps at 30 for scores above 300', () => {
    expect(reputationBoost(500n)).toBe(30);
    expect(reputationBoost(10_000n)).toBe(30);
  });
});

describe('agentIdToBytes32', () => {
  it('converts string to 32-byte hex', () => {
    const result = agentIdToBytes32('hermes-trader');
    expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.length).toBe(66); // 0x + 64 hex chars
  });

  it('produces deterministic output for same input', () => {
    expect(agentIdToBytes32('agent-1')).toBe(agentIdToBytes32('agent-1'));
  });

  it('produces different output for different inputs', () => {
    expect(agentIdToBytes32('agent-1')).not.toBe(agentIdToBytes32('agent-2'));
  });
});

describe('getReputationScore', () => {
  beforeEach(() => mockReadContract.mockReset());

  it('returns score from contract', async () => {
    mockReadContract.mockResolvedValueOnce(150n);
    const score = await getReputationScore('agent-1');
    expect(score).toBe(150n);
  });

  it('returns 0n on contract error', async () => {
    mockReadContract.mockRejectedValueOnce(new Error('rpc down'));
    const score = await getReputationScore('agent-1');
    expect(score).toBe(0n);
  });
});

describe('getAgentStats', () => {
  beforeEach(() => mockReadContract.mockReset());

  it('returns parsed stats object', async () => {
    mockReadContract.mockResolvedValueOnce({
      callsServed: 10n,
      callsFailed: 1n,
      signalsCorrect: 8n,
      signalsWrong: 2n,
      cumulativePnlBps: 50n,
      calibrationScore: 5n,
      totalRevenue: 1000n,
      reputationScore: 200n,
    });
    const stats = await getAgentStats('agent-1');
    expect(stats).toEqual({
      callsServed: 10n,
      callsFailed: 1n,
      signalsCorrect: 8n,
      signalsWrong: 2n,
      cumulativePnlBps: 50n,
      calibrationScore: 5n,
      totalRevenue: 1000n,
      reputationScore: 200n,
    });
  });

  it('returns null on error', async () => {
    mockReadContract.mockRejectedValueOnce(new Error('not found'));
    expect(await getAgentStats('agent-1')).toBeNull();
  });
});

describe('batchGetReputationScores', () => {
  beforeEach(() => mockReadContract.mockReset());

  it('fetches scores for multiple agents in parallel', async () => {
    mockReadContract.mockResolvedValueOnce(100n).mockResolvedValueOnce(50n).mockResolvedValueOnce(200n);
    const result = await batchGetReputationScores(['a', 'b', 'c']);
    expect(result.size).toBe(3);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
  });

  it('isolates errors per agent', async () => {
    mockReadContract
      .mockResolvedValueOnce(100n)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(50n);
    const result = await batchGetReputationScores(['a', 'b', 'c']);
    expect(result.get('a')).toBe(100n);
    expect(result.get('b')).toBe(0n); // error → 0
    expect(result.get('c')).toBe(50n);
  });
});

describe('rankAgentsWithReputation', () => {
  beforeEach(() => mockReadContract.mockReset());

  const agents = [
    {
      agentId: 'a1',
      name: 'A1',
      role: 'trader',
      capability: ['execution'],
      categories: ['trading'],
    },
    {
      agentId: 'a2',
      name: 'A2',
      role: 'trader',
      capability: ['execution'],
      categories: ['trading'],
    },
  ];

  it('boosts agent with higher reputation', async () => {
    // a1 has rep 200, a2 has rep 0 → a1 ranks first
    mockReadContract.mockResolvedValueOnce(200n).mockResolvedValueOnce(0n);
    const ranked = await rankAgentsWithReputation(
      { role: 'trader', capabilities: ['execution'] },
      agents,
    );
    expect(ranked.length).toBe(2);
    expect(ranked[0].agentId).toBe('a1');
    expect(ranked[0].repScore).toBe(200n);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('returns empty array when no base match', async () => {
    const ranked = await rankAgentsWithReputation(
      { role: 'unrelated-role', capabilities: [] },
      agents,
    );
    expect(ranked).toEqual([]);
  });
});
