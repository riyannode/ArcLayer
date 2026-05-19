import { describe, it, expect } from 'vitest';
import { scoreAgentForJob, rankAgentsForJob, AgentMatchCandidate } from './match-agents';

const auditor: AgentMatchCandidate = {
  agentId: 'openclaw-auditor',
  name: 'OpenClaw Auditor',
  role: 'security-auditor',
  capability: ['audit', 'code-review', 'exploit-check'],
  categories: ['security'],
  roles: [
    {
      id: 'audit',
      name: 'Security Auditor',
      category: 'security',
      capabilities: ['audit', 'code-review', 'exploit-check'],
    },
  ],
  x402: { enabled: true },
};

const trader: AgentMatchCandidate = {
  agentId: 'hermes-trader',
  name: 'Hermes Trader',
  role: 'trader',
  capability: ['execution', 'signal'],
  categories: ['trading'],
  x402: { enabled: true },
};

const writer: AgentMatchCandidate = {
  agentId: 'doc-writer',
  name: 'Doc Writer',
  role: 'writer',
  capability: ['markdown', 'translation'],
  categories: ['content'],
};

describe('scoreAgentForJob', () => {
  it('returns 0 when nothing matches', () => {
    expect(
      scoreAgentForJob({ role: 'trader', capabilities: ['execution'] }, writer),
    ).toBe(0);
  });

  it('rewards role exact match (+50)', () => {
    expect(
      scoreAgentForJob({ role: 'security-auditor', capabilities: [] }, auditor),
    ).toBe(50 + 5); // +5 x402
  });

  it('rewards category match (+20)', () => {
    expect(
      scoreAgentForJob({ category: 'security', capabilities: [] }, auditor),
    ).toBe(20 + 5);
  });

  it('rewards each capability match (+10)', () => {
    expect(
      scoreAgentForJob(
        { capabilities: ['audit', 'code-review'] },
        auditor,
      ),
    ).toBe(20 + 5); // 2 caps * 10 + x402 5
  });

  it('matches capability via nested roles[].capabilities', () => {
    const childOnly: AgentMatchCandidate = {
      ...auditor,
      capability: [], // top-level empty
    };
    expect(
      scoreAgentForJob({ capabilities: ['audit'] }, childOnly),
    ).toBe(10 + 5);
  });

  it('matches role via nested roles[].id', () => {
    const childRole: AgentMatchCandidate = {
      ...auditor,
      role: 'security-auditor', // ensure top-level still set
    };
    expect(
      scoreAgentForJob({ role: 'audit', capabilities: [] }, childRole),
    ).toBe(50 + 5);
  });

  it('x402 alone does not count as a substantive match', () => {
    expect(
      scoreAgentForJob({ capabilities: [] }, trader),
    ).toBe(0);
  });
  
  it('adds x402 bonus on top of a substantive match', () => {
    expect(
      scoreAgentForJob({ capabilities: ['execution'] }, trader),
    ).toBe(10 + 5);
  });
  
});

describe('rankAgentsForJob', () => {
  it('orders by score desc, excludes zero matches', () => {
    const ranked = rankAgentsForJob(
      { role: 'security-auditor', capabilities: ['audit'] },
      [trader, auditor, writer],
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].agentId).toBe('openclaw-auditor');
    expect(ranked[0].score).toBe(50 + 10 + 5);
  });

  it('breaks ties deterministically by agentId', () => {
    const a: AgentMatchCandidate = {
      agentId: 'b-agent',
      name: 'B',
      capability: ['x'],
      categories: [],
    };
    const b: AgentMatchCandidate = {
      agentId: 'a-agent',
      name: 'A',
      capability: ['x'],
      categories: [],
    };
    const ranked = rankAgentsForJob({ capabilities: ['x'] }, [a, b]);
    expect(ranked.map((r) => r.agentId)).toEqual(['a-agent', 'b-agent']);
  });

  it('returns empty array when no agent matches', () => {
    const ranked = rankAgentsForJob(
      { role: 'nonexistent', capabilities: ['nope'] },
      [trader, writer],
    );
    expect(ranked).toEqual([]);
  });
});
