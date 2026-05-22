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
  isLive: _isLive,
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
  const agents: NetworkAgent[] = [];
  const feedItems = feed?.items ?? [];

  // Registry-synced agents only (no hardcoded featured cards).
  if (registeredAgents && registeredAgents.length > 0) {
    const seenRegistryIds = new Set<string>();
    for (const reg of registeredAgents) {
      const regId = String(reg.agentId || '');
      const regKey = regId.toLowerCase();
      const meta = reg.metadata;
      if (!regKey || seenRegistryIds.has(regKey)) continue;
      seenRegistryIds.add(regKey);
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
