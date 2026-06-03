/**
 * Build an arclayer.agent/v1 manifest for an external bot.
 *
 * Wraps existing manifest lib types. Produces the schema expected by
 * POST /api/a2a/manifest (x402-protected).
 */

import type { AgentManifestV1 } from '@/lib/a2a/manifest';
import type { ExternalBotTemplate } from './templates';
import { scopesForRole } from './scopes';

export type ManifestBuildInput = {
  template: ExternalBotTemplate;
  agentId: string;
  roleIndex: number;
  controller: string;
  endpoint: string;
  priceAtomic: string;
  payerWallet?: string;
  /** Custom display name override — falls back to role.displayName */
  roleDisplayName?: string;
  /** Custom branded name override — falls back to role.defaultAgentId */
  roleBrandedName?: string;
};

export function buildExternalBotManifest(input: ManifestBuildInput): AgentManifestV1 {
  const { template, agentId, roleIndex, controller, endpoint, priceAtomic, payerWallet, roleDisplayName, roleBrandedName } = input;
  const role = template.roles[roleIndex];
  if (!role) throw new Error(`Role index ${roleIndex} out of bounds for template ${template.id}`);

  const mode = manifestMode(template.recommendedMode);
  const now = new Date().toISOString();
  const allScopes = scopesForRole(role.scopes, template.recommendedMode);
  const displayName = roleDisplayName || role.displayName;

  return {
    schema: 'arclayer.agent/v1',
    version: 1,
    agentId,
    name: `${template.name} — ${displayName}`,
    role: role.botRole,
    description: `${displayName}: ${role.capabilities.join(', ')}`,
    controller,
    // Only set endpoint if it's a valid URL (backend rejects bare filenames)
    ...(endpoint?.startsWith('http') ? { endpoint } : {}),
    mode,
    categories: [template.category],
    capability: role.capabilities,
    capabilities: role.capabilities,
    roles: [
      {
        id: role.roleId,
        name: displayName,
        category: template.category,
        capabilities: role.capabilities,
        endpointPath: role.endpointPath,
        enabled: true,
      },
    ],
    x402: {
      enabled: true,
      network: 'arc-testnet',
      currency: 'USDC',
      price: priceAtomic,
      receiver: payerWallet || controller,
      payTo: payerWallet || controller,
    },
    jobs: {
      accepts: mode === 'seller' || mode === 'dual'
        ? ['claim', 'run', 'submit-proof']
        : mode === 'buyer'
          ? ['create']
          : [],
      inputFormats: ['text', 'json'],
      outputFormats: ['markdown', 'json', 'proof'],
    },
    proof: {
      types: ['signed_result', 'workproof_nft', 'url'],
      signing: 'eip191',
    },
    host: 'self-hosted',
    createdAt: now,
    updatedAt: now,
  };
}

function manifestMode(mode: string): 'seller' | 'buyer' | 'dual' {
  switch (mode) {
    case 'bridge':
    case 'a2a-job-provider':
      return 'seller';
    case 'a2a-job-creator':
      return 'buyer';
    case 'hybrid':
    case 'erc8183-commerce':
      return 'dual';
    default:
      return 'seller';
  }
}
