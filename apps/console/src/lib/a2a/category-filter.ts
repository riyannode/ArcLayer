/**
 * Maps a registered agent (from /api/a2a/agents) to a category page key.
 *
 * An agent appears under a category if either:
 *   1. `metadata.categories[]` explicitly contains the category key, OR
 *   2. The agent's on-chain `role` maps to that category via the role table.
 *
 * Featured demo agents (Pythia / Apolo / Hermes / Ignia) are filtered out so
 * they don't double up with the hardcoded featured flow at the top of the page.
 */

export type RegistryAgent = {
  agentId: string;
  owner: string;
  role: string;
  roleId: number;
  endpoint: string;
  metadataURI: string;
  registeredAtBlock?: string;
  metadata: {
    name?: string;
    role?: string;
    description?: string;
    capability?: string[];
    categories?: string[];
    autonomous?: boolean;
    avatar?: string;
  };
};

// On-chain role → category page keys (categories.tsx).
// One role can surface in multiple categories.
const ROLE_TO_CATEGORIES: Record<string, string[]> = {
  MARKET_DATA: ['prediction-market-bots', 'data-oracle-agents'],
  TRADER: ['spot-trading-bots', 'prediction-market-bots'],
  EXECUTOR: ['spot-trading-bots', 'custom-workers'],
  ORACLE: ['data-oracle-agents', 'prediction-market-bots'],
  AGGREGATOR: ['a2a-commerce-agents', 'analyzer-agents'],
  ANALYZER: ['analyzer-agents', 'research-agents'],
  RESEARCH: ['research-agents'],
  RISK: ['risk-compliance-agents'],
  RWA: ['rwa-agents'],
  DEVOPS: ['devops-security-agents'],
};

// Featured demo agents that already render in the hardcoded flow at the top.
// Match by metadata.name (case-insensitive) — this is what registry writes.
const FEATURED_NAMES = new Set(['pythia', 'apolo', 'hermes', 'ignia', 'pythia-resolver']);

export function isFeaturedAgent(agent: RegistryAgent): boolean {
  const name = agent.metadata?.name?.toLowerCase().trim();
  if (!name) return false;
  return FEATURED_NAMES.has(name);
}

export function agentMatchesCategory(agent: RegistryAgent, categoryKey: string): boolean {
  // Explicit metadata.categories takes precedence.
  if (Array.isArray(agent.metadata?.categories) && agent.metadata.categories.length > 0) {
    return agent.metadata.categories.includes(categoryKey);
  }
  // Fallback: role-based mapping.
  const roleCats = ROLE_TO_CATEGORIES[agent.role] ?? [];
  return roleCats.includes(categoryKey);
}

export function filterAgentsByCategory(agents: RegistryAgent[], categoryKey: string): RegistryAgent[] {
  return agents.filter((a) => !isFeaturedAgent(a) && agentMatchesCategory(a, categoryKey));
}
