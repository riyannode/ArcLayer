import { AGENT_MANIFEST_SCHEMA, type AgentManifestV1 } from '@/lib/a2a/manifest/types';
import { parseManifest } from '@/lib/a2a/manifest/parse';
import { getOnboardingRolePreset } from './role-presets';

export type BuildAgentManifestInput = {
  agentId?: string;
  name?: string;
  rolePresetId?: string;
  description?: string;
  controller?: string;
  endpoint?: string;
  avatar?: string;
  customCapabilities?: string[];
  links?: AgentManifestV1['links'];
  createdAt?: string;
  updatedAt?: string;
  metadataURI?: string;
};

function unique(values: Array<string | undefined>, max = 12) {
  return Array.from(new Set(values.map((v) => v?.trim()).filter(Boolean) as string[])).slice(0, max);
}

export function buildAgentManifest(input: BuildAgentManifestInput): AgentManifestV1 {
  const preset = getOnboardingRolePreset(input.rolePresetId, { includeDisabled: true }) ?? getOnboardingRolePreset('provider', { includeDisabled: true })!;
  const now = input.updatedAt ?? new Date().toISOString();
  const capabilities = unique([...preset.capabilities, ...(input.customCapabilities ?? [])], 24);
  const categories = unique(preset.categories);
  const tags = unique(preset.tags);
  const manifest = {
    schema: AGENT_MANIFEST_SCHEMA,
    version: 1,
    agentId: input.agentId || `pending-${preset.id}`,
    name: input.name?.trim() || preset.title,
    role: preset.identityRole,
    description: input.description?.trim() || preset.description,
    controller: input.controller || undefined,
    endpoint: input.endpoint || undefined,
    mode: preset.mode,
    avatar: input.avatar || undefined,
    capability: capabilities.slice(0, 12),
    capabilities,
    categories,
    roles: [
      {
        id: preset.id,
        name: preset.title,
        category: 'erc8183-commerce',
        capabilities,
        enabled: true,
      },
    ],
    tags,
    links: input.links ?? {},
    x402: {
      enabled: preset.id === 'payment',
      network: 'arc-testnet',
      currency: 'USDC',
      receiver: input.controller || undefined,
      payTo: input.controller || undefined,
    },
    jobs: {
      accepts: preset.jobAccepts,
      inputFormats: ['text', 'json'],
      outputFormats: ['json', 'proof'],
    },
    proof: {
      types: ['signed_result', 'url'],
      signing: 'eip191',
    },
    host: 'erc8183-identity',
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  } satisfies AgentManifestV1 & { metadataURI?: string };

  if (input.metadataURI) {
    (manifest as AgentManifestV1 & { metadataURI?: string }).metadataURI = input.metadataURI;
  }

  const parsed = parseManifest(manifest);
  if (!parsed.ok) throw new Error(`built manifest failed validation: ${parsed.error}`);
  return manifest;
}
