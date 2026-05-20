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
  // On-chain status still exposes the legacy `pythia` key. Keep Pythia visible as the raw oracle.
  const pythiaStats = onchain?.agents.pythia?.stats ?? null;
  const igniaStats = pythiaStats;
  const apoloStats = onchain?.agents.apolo?.stats ?? null;
  const hermesStats = onchain?.agents.hermes?.stats ?? null;
  const feedItems = feed?.items ?? [];
  const pythiaId = onchain?.agents.pythia?.agentId;
  const igniaId = pythiaId;
  const apoloId = onchain?.agents.apolo?.agentId;
  const hermesId = onchain?.agents.hermes?.agentId;
  const pythiaActivity = feedItems.filter((item) => item.agent === 'Ignia' || item.agent === 'Pythia').slice(0, 8);
  const apoloActivity = feedItems.filter((item) => item.agent === 'Apolo' || item.label.toLowerCase().includes('apolo')).slice(0, 8);

  const agents: NetworkAgent[] = [
    {
      id: 'pythia',
      name: 'Pythia',
      role: 'Signal Oracle (raw)',
      capability: ['Polymarket Data', 'Multi-Strategy', 'Internal Feed'],
      description:
        'Raw signal oracle. Pulls live Polymarket gamma + CLOB data, runs multi-strategy signal scoring, and emits unfiltered signals to Apolo. Internal upstream oracle — Apolo is the paid decision seller.',
      status: isLive ? 'LIVE' : 'IDLE',
      wallet: onchain?.wallets?.pythia,
      agentId: pythiaId,
      reputation: pythiaStats?.reputationScore ?? 0,
      callsServed: pythiaStats?.callsServed ?? 0,
      jobsCompleted: jobsForAgent(overview, pythiaId),
      revenueRaw: '0',
      balanceRaw: onchain?.balances?.usdc?.pythia,
      primaryAction: 'View Signals',
      categories: ['signal-oracles', 'data-providers'],
      activity: pythiaActivity,
      source: 'featured',
      canHide: false,
      connectedTo: ['Apolo'],
    },
    {
      id: 'ignia',
      name: 'Ignia',
      role: 'Signal Engine',
      capability: ['Feature Engineering', 'Signal Normalization', 'Internal Feed'],
      description:
        'Internal signal engine behind Pythia. Normalizes market microstructure features before Apolo applies risk + veto policy.',
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
      activity: pythiaActivity,
      source: 'featured',
      canHide: false,
      connectedTo: ['Pythia', 'Apolo'],
    },
    {
      id: 'apolo',
      name: 'Apolo',
      role: 'Decision Resolver (paid)',
      capability: ['x402 Seller', 'Risk Policy', 'Final Decision'],
      description:
        'Paid decision engine. Consumes Ignia raw signals, applies risk + veto policy, and exposes APPROVED/DOWNGRADED/REJECTED decisions over x402. Charges 0.000001 USDC per call. The only oracle agent buyers actually pay.',
      status: isLive ? 'LIVE' : 'IDLE',
      wallet: onchain?.wallets?.pythia,
      agentId: apoloId,
      reputation: apoloStats?.reputationScore ?? 0,
      callsServed: apoloStats?.callsServed ?? 0,
      jobsCompleted: jobsForAgent(overview, apoloId),
      revenueRaw: apoloStats?.totalRevenue ?? '0',
      balanceRaw: onchain?.balances?.usdc?.pythia,
      primaryAction: 'Buy Decision',
      categories: ['signal-oracles', 'payment-agents'],
      activity: apoloActivity,
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

  // Registry-synced agents: merge A2A contract logs + indexer AgentRegistry rows.
  // Keep featured agents above, but skip duplicate cards by id/name/known on-chain agentId.
  if (registeredAgents && registeredAgents.length > 0) {
    const knownIds = new Set(
      ['ignia', 'apolo', 'hermes', 'pythia', pythiaId, igniaId, apoloId, hermesId]
        .filter(Boolean)
        .map((id) => String(id).toLowerCase())
    );
    for (const reg of registeredAgents) {
      const regId = String(reg.agentId || '');
      const regKey = regId.toLowerCase();
      const meta = reg.metadata;
      const regName = (meta?.name || '').trim().toLowerCase();
      if (knownIds.has(regKey) || (regName && knownIds.has(regName))) continue;
      if (hiddenIds?.has(regId)) continue;

      const completed = jobsForAgent(overview, regId);
      const receipts = overview?.proofs.filter((p) => p.agentId?.toLowerCase() === regKey) ?? [];
      const jobs = overview?.jobs.filter((job) => job.agentId?.toLowerCase() === regKey) ?? [];
      const volumeRaw = receipts.reduce((sum, p) => sum + BigInt(p.amountPaid || '0'), BigInt(0)).toString();
      const activity = [
        ...receipts.map((p) => ({
          id: `proof-${p.tokenId}`,
          ts: new Date(Number(p.mintedAt || '0') * 1000).toISOString(),
          agent: 'Apolo' as const,
          type: 'payment' as const,
          label: `Receipt #${p.tokenId} minted for job #${p.jobId}`,
          detail: `${Number(p.amountPaid || '0') / 1e6} USDC paid`,
        })),
        ...jobs.map((job) => ({
          id: `job-${job.id}`,
          ts: new Date(Number(job.createdAt || '0') * 1000).toISOString(),
          agent: 'Apolo' as const,
          type: 'decision' as const,
          label: `Job #${job.id} ${job.approved ? 'approved' : 'created'}`,
          detail: `${Number(job.fundedAmount || job.budget || '0') / 1e6} USDC budget`,
        })),
      ].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 8);

      agents.push({
        id: regId,
        name: meta?.name || `Agent ${regId.slice(0, 8)}`,
        role: meta?.role || 'Registered Agent',
        capability: meta?.capability || ['General'],
        description: meta?.description || 'Registered agent synced from ArcLayer registry/indexer.',
        status: completed > 0 || receipts.length > 0 ? 'LIVE' : 'IDLE',
        wallet: reg.controller,
        agentId: regId,
        avatar: meta?.avatar || undefined,
        reputation: Number((reg as any).reputationScore || 0),
        callsServed: receipts.length,
        jobsCompleted: completed,
        revenueRaw: volumeRaw,
        balanceRaw: null,
        primaryAction: 'Create Job',
        categories: (meta?.categories as NetworkAgent['categories']) || ['developers'],
        activity,
        source: 'registry',
        canHide: true,
        connectedTo: jobClientsForAgent(overview, regId),
      });
    }
  }

  return agents;
}
