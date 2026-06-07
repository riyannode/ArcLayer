import type { A2AOnChain, AgentReputationDetail, AutonomousFeed, Job, NetworkAgent, Overview, Proof, RegisteredAgent } from '@/types/agent-network';
import { asArray, asString, asNumber } from '@/lib/safeShape';
import { safeBigInt } from '@/lib/safeNumber';

function canonicalAgentId(reg: RegisteredAgent) {
  return String(reg.tokenId || reg.agentId || '').trim();
}

function agentProviderKeys(reg: RegisteredAgent) {
  return [
    reg.tokenId,
    reg.agentId,
    reg.controller,
    reg.owner,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function isJobForAgent(job: Job, keys: string[]) {
  const provider = asString(job.provider).toLowerCase();
  return provider.length > 0 && keys.includes(provider);
}

function isProofForAgent(proof: Proof, keys: string[]) {
  const agentId = asString(proof.agentId).toLowerCase();
  return agentId.length > 0 && keys.includes(agentId);
}

function jobsForAgent(overview: Overview | null, reg?: RegisteredAgent) {
  if (!overview || !reg) return 0;
  const keys = agentProviderKeys(reg);
  return asArray<Job>(overview.jobs).filter((job) => isJobForAgent(job, keys)).length;
}

function jobClientsForAgent(overview: Overview | null, reg?: RegisteredAgent) {
  if (!overview || !reg) return [];
  const keys = agentProviderKeys(reg);

  return Array.from(
    new Set(
      asArray<Job>(overview.jobs)
        .filter((job) => {
          const client = asString(job.client);
          return isJobForAgent(job, keys) && client.length > 0;
        })
        .map((job) => {
          const client = asString(job.client);
          return client.length > 6 ? `${client.slice(0, 6)}…${client.slice(-4)}` : client;
        })
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
      const regId = canonicalAgentId(reg);
      const regKey = regId.toLowerCase();
      const providerKeys = agentProviderKeys(reg);
      const meta = reg.metadata;
      if (!regKey || seenRegistryIds.has(regKey)) continue;
      seenRegistryIds.add(regKey);
      if (hiddenIds?.has(regId)) continue;

      const completed = jobsForAgent(overview, reg);
      const receipts = asArray<Proof>(overview?.proofs).filter((p) => isProofForAgent(p, providerKeys));
      const jobs = asArray<Job>(overview?.jobs).filter((job) => isJobForAgent(job, providerKeys));
      const volumeRaw = receipts.reduce((sum, p) => sum + safeBigInt(p.amountPaid as string | undefined), BigInt(0)).toString();
      const activity = [
        ...receipts.map((p) => {
          const tokenId = asString(p.tokenId);
          const jobId = asString(p.jobId);
          const mintedAt = asString(p.mintedAt);
          const amountPaid = safeBigInt(p.amountPaid as string | undefined);
          return {
            id: `proof-${tokenId}`,
            ts: new Date(Number(mintedAt || '0') * 1000).toISOString(),
            agent: meta?.name || `Agent ${regId.slice(0, 8)}`,
            type: 'payment' as const,
            label: `Receipt #${tokenId} minted for job #${jobId}`,
            detail: `${Number(amountPaid) / 1e6} USDC paid`,
          };
        }),
        ...jobs.map((job) => {
          const jobId = asString(job.id);
          const createdAt = asString(job.createdAt);
          const fundedAmount = safeBigInt(job.fundedAmount as string | undefined);
          const budget = safeBigInt(job.budget as string | undefined);
          return {
            id: `job-${jobId}`,
            ts: new Date(Number(createdAt || '0') * 1000).toISOString(),
            agent: meta?.name || `Agent ${regId.slice(0, 8)}`,
            type: 'decision' as const,
            label: `Job #${jobId} ${job.status === 3 ? 'completed' : 'created'}`,
            detail: `${Number(fundedAmount || budget || '0') / 1e6} USDC budget`,
          };
        }),
      ].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 8);

      agents.push({
        id: regId,
        tokenId: reg.tokenId ?? (/^\d+$/.test(regId) ? regId : null),
        name: asString(meta?.name) || `Agent ${regId.slice(0, 8)}`,
        role: asString(meta?.role) || 'Registered Agent',
        capability: asArray<string>(meta?.capability).length > 0 ? asArray<string>(meta?.capability) : ['General'],
        description: asString(meta?.description) || 'Registered agent synced from ERC-8004 identity/indexer.',
        status: completed > 0 || receipts.length > 0 ? 'LIVE' : 'IDLE',
        wallet: asString(reg.controller),
        owner: asString(reg.owner),
        controller: asString(reg.controller),
        agentId: regId,
        metadataURI: asString(reg.metadataURI),
        source: reg.source || 'erc8004_identity_registry',
        avatar: asString(meta?.avatar) || undefined,
        reputation: asNumber((reg as any).reputationScore ?? (reg as any).score ?? (reg as any).reputation?.score, 0),
        reputationDetail: (reg as any).reputation as AgentReputationDetail | undefined,
        callsServed: receipts.length,
        jobsCompleted: completed,
        revenueRaw: volumeRaw,
        balanceRaw: null,
        primaryAction: 'Create Job',
        categories: (asArray(meta?.categories).length > 0 ? asArray(meta?.categories) : ['developers']) as NetworkAgent['categories'],
        activity,
        canHide: true,
        connectedTo: jobClientsForAgent(overview, reg),
      });
    }
  }

  return agents;
}
