/**
 * Canonical profile filtering for ArcLayer platform agents.
 *
 * Controls which agents appear in public discovery vs. private profile views.
 * External on-chain ERC-8004 agents are hidden by default until they pass
 * through ArcLayer's manifest/draft/metadata pipeline.
 *
 * Modes:
 *   - platform-only:  Only ArcLayer platform agents (default)
 *   - platform-first: ArcLayer first, owned external can appear in /profile
 *   - open-erc8004:   Future — show all ERC-8004 agents
 */

export type CanonicalProfileMode =
  | 'platform-only'
  | 'platform-first'
  | 'open-erc8004';

export type CanonicalAgentSource =
  | 'manifest'
  | 'draft'
  | 'onchain'
  | 'indexer';

export type CanonicalAgentLike = {
  agentId: string;
  controller?: string | null;
  source: CanonicalAgentSource;
  metadata?: unknown;
  tokenURI?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

const ARCLAYER_METADATA_HOSTS = new Set([
  'arclayers.xyz',
  'www.arclayers.xyz',
]);

function isArcLayerTokenURI(tokenURI: string) {
  if (tokenURI.startsWith('arclayer://manifest/')) {
    return true;
  }

  try {
    const url = new URL(tokenURI);
    const host = url.hostname.toLowerCase();
    const path = url.pathname;

    if (url.protocol !== 'https:') {
      return false;
    }

    if (!ARCLAYER_METADATA_HOSTS.has(host)) {
      return false;
    }

    return (
      path.startsWith('/api/a2a/metadata/draft/') ||
      path.startsWith('/api/a2a/manifest') ||
      path.startsWith('/api/a2a/metadata/agent/')
    );
  } catch {
    return false;
  }
}

/**
 * Returns true if the agent qualifies as an ArcLayer platform agent.
 *
 * Matches on:
 *   - source === 'manifest' (registered via /api/a2a/register)
 *   - source === 'draft'    (minted via /api/a2a/metadata/draft)
 *   - tokenURI pointing to arclayer:// or arclayers.xyz
 *   - metadata.schema === 'arclayer.agent/v1' with matching categories/tags
 */
export function isArcLayerPlatformAgent(agent: CanonicalAgentLike) {
  if (agent.source === 'manifest') return true;
  if (agent.source === 'draft') return true;

  if (agent.tokenURI && isArcLayerTokenURI(agent.tokenURI)) {
    return true;
  }

  if (!isRecord(agent.metadata)) return false;

  const schema = agent.metadata.schema;
  const categories = stringArray(agent.metadata.categories);
  const tags = stringArray(agent.metadata.tags);

  return (
    schema === 'arclayer.agent/v1' &&
    (
      categories.includes('arclayer') ||
      categories.includes('erc8183-commerce') ||
      categories.includes('agentic-commerce') ||
      tags.includes('arclayer') ||
      tags.includes('erc8183') ||
      tags.includes('agentic-commerce')
    )
  );
}

/**
 * Reads the canonical profile mode from environment.
 * Defaults to 'platform-only' when unset or invalid.
 */
export function getCanonicalProfileMode(): CanonicalProfileMode {
  const raw = process.env.ARCLAYER_PROFILE_CANONICAL_MODE;

  if (
    raw === 'platform-only' ||
    raw === 'platform-first' ||
    raw === 'open-erc8004'
  ) {
    return raw;
  }

  return 'platform-only';
}

/**
 * Determines whether an agent should be exposed on a given surface.
 *
 * @param surface - 'discovery' = public category pages; 'profile' = private /profile view
 * @param controller - the viewer's wallet address (used for platform-first owner filtering)
 */
export function shouldExposeAgent(input: {
  agent: CanonicalAgentLike;
  mode: CanonicalProfileMode;
  surface: 'profile' | 'discovery';
  controller?: string;
}) {
  const isPlatform = isArcLayerPlatformAgent(input.agent);

  if (input.mode === 'platform-only') {
    return isPlatform;
  }

  if (input.mode === 'platform-first') {
    // Discovery always shows only platform agents
    if (input.surface === 'discovery') return isPlatform;

    // Profile: platform agents always show; external only if owned by viewer
    const requestedController = input.controller?.toLowerCase();
    const agentController = input.agent.controller?.toLowerCase();

    return isPlatform || Boolean(requestedController && requestedController === agentController);
  }

  if (input.mode === 'open-erc8004') {
    return true;
  }

  return isPlatform;
}

/**
 * Returns a numeric sort rank for platform-first ordering.
 * Lower rank = appears first in the list.
 */
export function platformSortRank(agent: CanonicalAgentLike) {
  if (agent.source === 'manifest') return 0;
  if (agent.source === 'draft') return 1;
  if (isArcLayerPlatformAgent(agent)) return 2;
  if (agent.source === 'indexer') return 3;
  if (agent.source === 'onchain') return 4;
  return 9;
}

/**
 * Returns a display badge label for the agent's canonical source.
 */
export function getAgentBadge(agent: CanonicalAgentLike) {
  if (agent.source === 'manifest') return 'ArcLayer Published';
  if (agent.source === 'draft') return 'ArcLayer Minted';
  if (isArcLayerPlatformAgent(agent)) return 'ArcLayer Compatible';
  return 'External ERC-8004';
}
