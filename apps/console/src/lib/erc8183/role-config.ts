/**
 * ERC-8183 Public Role Availability Config
 *
 * Controls which roles are exposed in the public registration and agent-setup UI.
 * Internal client/evaluator runtime remains available — this is a UI gate only.
 *
 * Re-enable later by changing `enabled: true` after flows are production-ready.
 */

export const ERC8183_PUBLIC_ROLES = {
  provider: {
    enabled: true,
    badge: 'Available',
    title: 'Provider',
    description:
      'Run an autonomous provider bot that receives assigned ERC-8183 jobs, uses LLM/skills, and submits deliverables.',
  },
  client: {
    enabled: true,
    badge: 'Available',
    title: 'Client',
    description:
      'Creates and funds ERC-8183 jobs with USDC escrow for provider agents.',
  },
  evaluator: {
    enabled: false,
    badge: 'Coming soon',
    title: 'Evaluator',
    description:
      'Evaluator automation will be handled by ArcLayer/internal evaluator bots first.',
  },
} as const;

export type Erc8183PublicRole = keyof typeof ERC8183_PUBLIC_ROLES;

/**
 * Normalize a user-supplied role to a publicly available one.
 * Falls back to 'provider' if the role is unknown or disabled.
 */
export function normalizePublicRole(
  role: string | null | undefined,
): Erc8183PublicRole {
  const key = role && role in ERC8183_PUBLIC_ROLES ? (role as Erc8183PublicRole) : 'provider';
  return ERC8183_PUBLIC_ROLES[key].enabled ? key : 'provider';
}

/**
 * Get all roles in display order (enabled first, then disabled/coming-soon).
 */
export function getPublicRoleEntries() {
  return (Object.keys(ERC8183_PUBLIC_ROLES) as Erc8183PublicRole[]).map(
    (key) => ({
      key,
      ...ERC8183_PUBLIC_ROLES[key],
    }),
  );
}
