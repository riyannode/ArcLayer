import type { A2AOnChain, AutonomousFeed, NetworkAgent, Overview } from '@/types/agent-network';

function jobsForAgent(overview: Overview | null, agentId?: string) {
  if (!overview || !agentId) return 0;
  return overview.jobs.filter((job) => job.agentId?.toLowerCase() === agentId.toLowerCase()).length;
}

export function buildAgentNetwork({
  onchain,
  overview,
  feed,
  isLive,
}: {
  onchain: A2AOnChain | null;
  overview: Overview | null;
  feed: AutonomousFeed | null;
  isLive: boolean;
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
    },
  ];

  const known = new Set([pythiaId?.toLowerCase(), hermesId?.toLowerCase()].filter(Boolean));
  const dynamicIds = new Set<string>();
  overview?.jobs.forEach((job) => {
    const id = job.agentId;
    if (id && !known.has(id.toLowerCase())) dynamicIds.add(id);
  });
  overview?.proofs.forEach((proof) => {
    const id = proof.agentId;
    if (id && !known.has(id.toLowerCase())) dynamicIds.add(id);
  });

  Array.from(dynamicIds).slice(0, 12).forEach((agentId, index) => {
    const completed = jobsForAgent(overview, agentId);
    const receipts = overview?.proofs.filter((proof) => proof.agentId?.toLowerCase() === agentId.toLowerCase()) ?? [];
    const volumeRaw = receipts.reduce((sum, proof) => sum + BigInt(proof.amountPaid || '0'), BigInt(0)).toString();
    agents.push({
      id: agentId,
      name: `Agent #${index + 1}`,
      role: 'Registered Agent',
      capability: ['General'],
      description: 'Registered autonomous agent. Metadata is not available yet, so ArcLayer shows safe registry-derived fallback data.',
      status: completed > 0 || receipts.length > 0 ? 'LIVE' : 'IDLE',
      agentId,
      reputation: 0,
      callsServed: 0,
      jobsCompleted: completed,
      revenueRaw: volumeRaw,
      primaryAction: 'Create Job',
      categories: ['developers'],
      activity: [],
    });
  });

  return agents;
}
