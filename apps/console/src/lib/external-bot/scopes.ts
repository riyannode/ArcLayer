/**
 * External bot API key scopes.
 *
 * Least-privilege scopes per onboarding mode.
 * bridge scopes are always included for event/receipt publishing.
 */

export const EXTERNAL_BOT_SCOPES = {
  bridge: ['agent_bridge:write', 'agent_bridge:receipt'] as const,
  liveEvents: ['live_events:write', 'presence:write'] as const,
  a2aJobWorker: ['jobs:claim', 'jobs:submit', 'jobs:verify', 'jobs:settle'] as const,
  a2aJobCreator: ['jobs:create'] as const,
  erc8183Commerce: [
    'erc8183:create',
    'erc8183:confirm',
    'erc8183:claim',
    'erc8183:running',
    'erc8183:submit',
    'erc8183:complete',
    'erc8183:tx',
  ] as const,
  x402Pay: ['x402:pay'] as const,
} as const;

export function scopesForMode(mode: string): string[] {
  const bridge = [...EXTERNAL_BOT_SCOPES.bridge];
  const liveEvents = [...EXTERNAL_BOT_SCOPES.liveEvents];

  switch (mode) {
    case 'bridge':
      return [...liveEvents, ...bridge];
    case 'a2a-job-worker':
      return [...EXTERNAL_BOT_SCOPES.a2aJobWorker, ...liveEvents, ...bridge];
    case 'a2a-job-creator':
      return [...EXTERNAL_BOT_SCOPES.a2aJobCreator, ...liveEvents, ...bridge];
    case 'hybrid':
      return [
        ...EXTERNAL_BOT_SCOPES.a2aJobCreator,
        ...EXTERNAL_BOT_SCOPES.a2aJobWorker,
        ...liveEvents,
        ...bridge,
      ];
    case 'erc8183-commerce':
      return [...EXTERNAL_BOT_SCOPES.erc8183Commerce, ...liveEvents, ...bridge];
    default:
      return [...liveEvents, ...bridge];
  }
}

export function scopesForRole(roleScopes: string[], mode: string): string[] {
  const modeScopes = scopesForMode(mode);
  const combined = new Set([...roleScopes, ...modeScopes]);
  return Array.from(combined);
}
