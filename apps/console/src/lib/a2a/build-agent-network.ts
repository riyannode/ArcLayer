import type { A2AOnChain, AutonomousFeed, NetworkAgent, Overview, RegisteredAgent } from '@/types/agent-network';

function jobsForAgent(overview: Overview | null, agentId?: string) {
  if (!overview || !agentId) return 0;
  return overview.jobs.filter((job) => job.agentId?.toLowerCase() === agentId.toLowerCase()).length;
}

export function buildAgentNetwork({
  onchain,
  overview,
  feed,
  isLive,
  registeredAgents,
  hiddenIds,
}: {
  onchain: A2AOnChain | null;
  overview: Overview | null;
  feed: AutonomousFeed | null;
  isLive: boolean;
  registeredAgents?: RegisteredAgent[];
  hiddenIds?: Set<string>;
}): NetworkAgent[] {
  const pythiaStats = onchain?.agents.pythia?.stats ?? null;
  const hermesStats = onchain?.agents.hermes?.stats ?? null;
  const feedItems = feed?.items ?? [];
  const pythiaId = onchain?.agents.pythia?.agentId;
  const hermesId = onchain?.agents.hermes?.agentId;

  const agents: NetworkAgent[] = [
    {
      id: 'pythia',
      name: 'Pythia',
      role: 'Signal Oracle',
      capability: ['Data Provider', 'Demo Strategy', 'x402 Seller'],
      description: 'Programmable data provider agent. Returns demo market signals to validate request, payment, receipt, and reputation rails.',
      status: isLive ? 'LIVE' : 'IDLE',
      wallet: onchain?.wallets?.pythia,
      agentId: pythiaId,
      reputation: pythiaStats?.reputationScore ?? 0,
      callsServed: pythiaStats?.callsServed ?? 0,
      jobsCompleted: jobsForAgent(overview, pythiaId),
      revenueRaw: pythiaStats?.totalRevenue ?? '0',
      balanceRaw: onchain?.balances?.usdc?.pythia,
      primaryAction: 'Request Signal',
      categories: ['signal-oracles', 'data-providers', 'payment-agents'],
      activity: feedItems.filter((item) => item.agent === 'Pythia').slice(0, 8),
      source: 'featured',
      canHide: false,
    },
    {
      id: 'hermes',
      name: 'Hermes',
      role: 'Autonomous Trader',
      capability: ['Consumer Agent', 'Payment Agent', 'Decision Engine'],
      description: 'Autonomous consumer agent. Requests services from oracle agents, pays via x402, and records all interactions on-chain.',
      status: isLive ? 'RUNNING' : 'IDLE',
      wallet: onchain?.wallets?.hermes,
      agentId: hermesId,
      reputation: hermesStats?.reputationScore ?? 0,
      callsServed: hermesStats?.callsServed ?? 0,
      jobsCompleted: jobsForAgent(overview, hermesId),
      revenueRaw: hermesStats?.totalRevenue ?? '0',
      balanceRaw: onchain?.balances?.usdc?.hermes,
      primaryAction: 'View Decisions',
      categories: ['traders', 'payment-agents'],
      activity: feedItems.filter((item) => item.agent === 'Hermes').slice(0, 8),
      source: 'featured',
      canHide: false,
    },
  ];

  // Registry-synced autonomous agents (only those with metadata.autonomous === true)
  if (registeredAgents && registeredAgents.length > 0) {
    const knownIds = new Set(['pythia', 'hermes']);
    for (const reg of registeredAgents) {
      if (knownIds.has(reg.agentId.toLowerCase())) continue;
      if (hiddenIds?.has(reg.agentId)) continue;

      const meta = reg.metadata;
      const completed = jobsForAgent(overview, reg.agentId);
      const receipts = overview?.proofs.filter((p) => p.agentId?.toLowerCase() === reg.agentId.toLowerCase()) ?? [];
      const volumeRaw = receipts.reduce((sum, p) => sum + BigInt(p.amountPaid || '0'), BigInt(0)).toString();

      agents.push({
        id: reg.agentId,
        name: meta?.name || `Agent ${reg.agentId.slice(0, 8)}`,
        role: meta?.role || 'Autonomous Agent',
        capability: meta?.capability || ['General'],
        description: meta?.description || 'Registered autonomous agent synced from AgentRegistry.',
        status: completed > 0 || receipts.length > 0 ? 'LIVE' : 'IDLE',
        wallet: reg.controller,
        agentId: reg.agentId,
        reputation: 0,
        callsServed: 0,
        jobsCompleted: completed,
        revenueRaw: volumeRaw,
        balanceRaw: null,
        primaryAction: 'Create Job',
        categories: (meta?.categories as NetworkAgent['categories']) || ['developers'],
        activity: [],
        source: 'registry',
        canHide: true,
      });
    }
  }

  return agents;
}
