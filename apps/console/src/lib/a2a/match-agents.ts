import { AgentManifestV1, AgentManifestRole } from './manifest/types';

export type JobMatchInput = {
  role?: string;
  category?: string;
  capabilities: string[];
};

export type AgentMatchCandidate = {
  agentId: string;
  name: string;
  endpoint?: string;
  role?: string;
  roles?: AgentManifestRole[];
  capability: string[];
  categories: string[];
  x402?: AgentManifestV1['x402'];
};

/**
 * Score an agent's fitness for a job.
 * Higher = better match. Returns 0 when there is no substantive hit
 * (role / category / capability). x402 is only a bonus on top of a real match.
 *
 * Scoring:
 *  - role exact match: +50
 *  - category match: +20
 *  - each capability match: +10
 *  - x402 enabled (only when score>0 already): +5
 */
export function scoreAgentForJob(job: JobMatchInput, agent: AgentMatchCandidate): number {
  let score = 0;

  // Role match (check top-level role AND nested roles[].id)
  if (job.role) {
    if (agent.role === job.role) {
      score += 50;
    } else if (agent.roles?.some((r) => r.id === job.role || r.category === job.role)) {
      score += 50;
    }
  }

  // Category match
  if (job.category && agent.categories.includes(job.category)) {
    score += 20;
  }

  // Capability matches
  for (const cap of job.capabilities) {
    if (agent.capability.includes(cap)) {
      score += 10;
    } else if (agent.roles?.some((r) => r.capabilities.includes(cap))) {
      score += 10;
    }
  }

  // x402 bonus — only applies if there's already a substantive match
  if (score > 0 && agent.x402?.enabled) {
    score += 5;
  }

  return score;
}

/**
 * Rank agents for a job, highest score first.
 * Agents with score 0 are excluded (no match at all).
 * Ties broken by agentId for determinism.
 */
export function rankAgentsForJob(
  job: JobMatchInput,
  agents: AgentMatchCandidate[],
): (AgentMatchCandidate & { score: number })[] {
  const scored = agents.map((a) => ({ ...a, score: scoreAgentForJob(job, a) }));
  return scored
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId));
}
