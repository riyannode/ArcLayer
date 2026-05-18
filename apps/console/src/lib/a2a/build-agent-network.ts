import type { A2AOnChain, AutonomousFeed, NetworkAgent, Overview, RegisteredAgent } from '@/types/agent-network';

function jobsForAgent(overview: Overview | null, agentId?: string) {
  if (!overview || !agentId) return 0;
  return overview.jobs.filter((job) => job.agentId?.toLowerCase() === agentId.toLowerCase()).length;
}

function jobClientsForAgent(overview: Overview | null, agentId?: string) {
  if (!overview || !agentId) return [];
  return Array.from(
    new Set(
      overview.jobs
        .filter((job) => job.agentId?.toLowerCase() === agentId.toLowerCase() && job.client)
        .map((job) => `${job.client.slice(0, 6)}…${job.client.slice(-4)}`)
    )
  ).slice(0, 2);
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
  // On-chain stats live under legacy keys (pythia/hermes) — re-brand as Ignia/Hermes here.
  const igniaStats = onchain?.agents.pythia?.stats ?? null;
  const hermesStats = onchain?.agents.hermes?.stats ?? null;
  const feedItems = feed?.items ?? [];
  const igniaId = onchain?.agents.pythia?.agentId;
  const hermesId = onchain?.agents.hermes?.agentId;

  const agents: NetworkAgent[] = [
    {
      id: 'ignia',
      name: 'Ignia',
      role: 'Signal Oracle (raw)',
      capability: ['Polymarket Data', 'Multi-Strategy', 'Internal Feed'],
      description:
        'Raw-signal oracle. Pulls live Polymarket gamma + CLOB data, runs 6 strategies (regime, microstructure, sniper, forecast-edge, synthetic-arb, entry-quality), and emits unfiltered signals to Apolo. Free, internal-only — never sells directly.',
      status: isLive ? 'LIVE' : 'IDLE',
      wallet: onchain?.wallets?.pythia,
      agentId: igniaId,
      reputation: igniaStats?.reputationScore ?? 0,
      callsServed: igniaStats?.callsServed ?? 0,
      jobsCompleted: jobsForAgent(overview, igniaId),
      revenueRaw: '0',
      balanceRaw: onchain?.balances?.usdc?.pythia,
      primaryAction: 'View Signals',
      categories: ['signal-oracles', 'data-providers'],
      activity: feedItems.filter((item) => item.agent === 'Ignia').slice(0, 8),
      source: 'featured',
      canHide: false,
      connectedTo: [],
    },
    {
      id: 'apolo',
      name: 'Apolo',
      role: 'Decision Resolver (paid)',
      capability: ['x402 Seller', 'Risk Policy', 'Final Decision'],
      description:
        'Paid decision engine. Consumes Ignia raw signals, applies risk + veto policy, and exposes APPROVED/DOWNGRADED/REJECTED decisions over x402. Charges 0.01 USDC per call. The only oracle agent buyers actually pay.',
      status: isLive ? 'LIVE' : 'IDLE',
      wallet: onchain?.wallets?.pythia,
      agentId: igniaId,
      reputation: igniaStats?.reputationScore ?? 0,
      callsServed: igniaStats?.callsServed ?? 0,
      jobsCompleted: 0,
      revenueRaw: igniaStats?.totalRevenue ?? '0',
      balanceRaw: onchain?.balances?.usdc?.pythia,
      primaryAction: 'Buy Decision',
      categories: ['signal-oracles', 'payment-agents'],
      activity: feedItems.filter((item) => item.agent === 'Apolo').slice(0, 8),
      source: 'featured',
      canHide: false,
      connectedTo: ['Ignia'],
    },
    {
      id: 'hermes',
      name: 'Hermes',
      role: 'Autonomous Trader',
      capability: ['Consumer Agent', 'Payment Agent', 'PnL Tracker'],
      description:
        'Autonomous consumer agent. Pays Apolo via x402 for final trade decisions, executes mock Polymarket trades, and tracks PnL/winrate against actual market settlement.',
      status: isLive ? 'RUNNING' : 'IDLE',
      wallet: onchain?.wallets?.hermes,
      agentId: hermesId,
      reputation: hermesStats?.reputationScore ?? 0,
      callsServed: hermesStats?.callsServed ?? 0,
      jobsCompleted: jobsForAgent(overview, hermesId),
      revenueRaw: hermesStats?.totalRevenue ?? '0',
      balanceRaw: onchain?.balances?.usdc?.hermes,
      primaryAction: 'View Trades',
      categories: ['traders', 'payment-agents'],
      activity: feedItems.filter((item) => item.agent === 'Hermes').slice(0, 8),
      source: 'featured',
      canHide: false,
      connectedTo: ['Apolo'],
    },
  ];

  // Registry-synced autonomous agents (only those with metadata.autonomous === true)
  if (registeredAgents && registeredAgents.length > 0) {
    const knownIds = new Set(['ignia', 'apolo', 'hermes', 'pythia']);
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
        connectedTo: jobClientsForAgent(overview, reg.agentId),
      });
    }
  }

  return agents;
}
