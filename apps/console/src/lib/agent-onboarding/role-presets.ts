import { ERC8183_PUBLIC_ROLES } from '@/lib/erc8183/role-config';
import type { AgentManifestMode } from '@/lib/a2a/manifest/types';

export type OnboardingRolePresetId =
  | 'provider'
  | 'client'
  | 'evaluator'
  | 'smart-contract'
  | 'frontend'
  | 'backend'
  | 'devops'
  | 'design'
  | 'data-research'
  | 'documentation'
  | 'analysis'
  | 'payment';

export type OnboardingRolePreset = {
  id: OnboardingRolePresetId;
  title: string;
  label: string;
  description: string;
  identityRole: 'provider' | 'client' | 'evaluator';
  mode: AgentManifestMode;
  category: string;
  capabilities: string[];
  categories: string[];
  tags: string[];
  jobAccepts: string[];
  enabled: boolean;
};

const ERC8183_CATEGORIES = ['erc8183-commerce'] as const;
const ERC8183_TAGS = ['erc8183', 'erc8183-commerce', 'agentic-commerce'] as const;
const PROVIDER_LIFECYCLE = ['claim_job', 'submit_work'] as const;
const CLIENT_LIFECYCLE = ['job-creation', 'escrow', 'create_job', 'fund_escrow'] as const;
const EVALUATOR_LIFECYCLE = ['approve_result', 'settle_job', 'evaluate_work', 'complete_job'] as const;

function unique(values: string[], max = 12) {
  return Array.from(new Set(values.filter(Boolean))).slice(0, max);
}

function preset(input: Omit<OnboardingRolePreset, 'categories' | 'tags'> & { categories?: string[]; tags?: string[] }): OnboardingRolePreset {
  return {
    ...input,
    capabilities: unique(input.capabilities, 24),
    categories: unique([...ERC8183_CATEGORIES, ...(input.categories ?? [])]),
    tags: unique([...ERC8183_TAGS, input.id, input.category, ...(input.tags ?? [])]),
  };
}

export const AGENT_ONBOARDING_ROLE_PRESETS: Record<OnboardingRolePresetId, OnboardingRolePreset> = {
  provider: preset({
    id: 'provider',
    title: 'Provider Agent',
    label: 'Provider',
    description: 'Performs ERC-8183 work and submits deliverables.',
    identityRole: 'provider',
    mode: 'seller',
    category: 'provider',
    capabilities: [...PROVIDER_LIFECYCLE, 'provider'],
    jobAccepts: ['claim', 'run', 'submit-proof'],
    enabled: ERC8183_PUBLIC_ROLES.provider.enabled,
  }),
  client: preset({
    id: 'client',
    title: 'Client Agent',
    label: 'Client',
    description: 'Creates and funds ERC-8183 escrow jobs.',
    identityRole: 'client',
    mode: 'buyer',
    category: 'client',
    capabilities: [...CLIENT_LIFECYCLE, 'client'],
    jobAccepts: ['create'],
    enabled: ERC8183_PUBLIC_ROLES.client.enabled,
  }),
  evaluator: preset({
    id: 'evaluator',
    title: 'Evaluator Agent',
    label: 'Evaluator',
    description: 'Reviews work and settles ERC-8183 jobs.',
    identityRole: 'evaluator',
    mode: 'dual',
    category: 'evaluator',
    capabilities: [...EVALUATOR_LIFECYCLE, 'evaluator'],
    jobAccepts: ['run', 'submit-proof', 'complete'],
    enabled: ERC8183_PUBLIC_ROLES.evaluator.enabled,
  }),
  'smart-contract': preset({
    id: 'smart-contract',
    title: 'Smart Contract Agent',
    label: 'Smart Contract Agent',
    description: 'Reviews Solidity contracts and submits ERC-8183 job deliverables.',
    identityRole: 'provider',
    mode: 'seller',
    category: 'smart-contract',
    capabilities: [...PROVIDER_LIFECYCLE, 'smart-contract', 'solidity-audit'],
    jobAccepts: ['claim', 'run', 'submit-proof'],
    enabled: true,
  }),
  frontend: preset({ id: 'frontend', title: 'Frontend Agent', label: 'Frontend Agent', description: 'Builds UI components and frontend deliverables.', identityRole: 'provider', mode: 'seller', category: 'frontend', capabilities: [...PROVIDER_LIFECYCLE, 'frontend', 'react', 'ui-implementation'], jobAccepts: ['claim', 'run', 'submit-proof'], enabled: true }),
  backend: preset({ id: 'backend', title: 'Backend Agent', label: 'Backend Agent', description: 'Builds backend services, API routes, and database integrations.', identityRole: 'provider', mode: 'seller', category: 'backend', capabilities: [...PROVIDER_LIFECYCLE, 'backend', 'api', 'database'], jobAccepts: ['claim', 'run', 'submit-proof'], enabled: true }),
  devops: preset({ id: 'devops', title: 'DevOps Agent', label: 'DevOps Agent', description: 'Handles deployment, monitoring, environment setup, and infrastructure tasks.', identityRole: 'provider', mode: 'seller', category: 'devops', capabilities: [...PROVIDER_LIFECYCLE, 'devops', 'deployment', 'monitoring'], jobAccepts: ['claim', 'run', 'submit-proof'], enabled: true }),
  design: preset({ id: 'design', title: 'Design Agent', label: 'Design Agent', description: 'Creates design reviews, UI structure, and product experience recommendations.', identityRole: 'provider', mode: 'seller', category: 'design', capabilities: [...PROVIDER_LIFECYCLE, 'design', 'ui-ux', 'product-design'], jobAccepts: ['claim', 'run', 'submit-proof'], enabled: true }),
  'data-research': preset({ id: 'data-research', title: 'Data Research Agent', label: 'Data Research Agent', description: 'Researches data, summarizes findings, and submits structured deliverables.', identityRole: 'provider', mode: 'seller', category: 'data-research', capabilities: [...PROVIDER_LIFECYCLE, 'research', 'data-analysis', 'market-data'], jobAccepts: ['claim', 'run', 'submit-proof'], enabled: true }),
  documentation: preset({ id: 'documentation', title: 'Documentation Agent', label: 'Documentation Agent', description: 'Writes docs, README updates, integration guides, and technical explanations.', identityRole: 'provider', mode: 'seller', category: 'documentation', capabilities: [...PROVIDER_LIFECYCLE, 'documentation', 'technical-writing'], jobAccepts: ['claim', 'run', 'submit-proof'], enabled: true }),
  analysis: preset({ id: 'analysis', title: 'Analysis Agent', label: 'Analysis Agent', description: 'Analyzes requirements, reviews outputs, and produces structured reports.', identityRole: 'provider', mode: 'seller', category: 'analysis', capabilities: [...PROVIDER_LIFECYCLE, 'analysis', 'evaluation', 'reasoning'], jobAccepts: ['claim', 'run', 'submit-proof'], enabled: true }),
  payment: preset({ id: 'payment', title: 'Payment Agent', label: 'Payment Agent', description: 'Handles payment flows, x402 access, USDC settlement, and receipt workflows.', identityRole: 'provider', mode: 'seller', category: 'payment', capabilities: [...PROVIDER_LIFECYCLE, 'x402', 'payments', 'usdc'], jobAccepts: ['claim', 'run', 'submit-proof'], enabled: true }),
};

export function normalizeOnboardingRolePreset(rolePresetId: string | null | undefined): OnboardingRolePresetId {
  const key = String(rolePresetId || '').trim().toLowerCase() as OnboardingRolePresetId;
  return key in AGENT_ONBOARDING_ROLE_PRESETS ? key : 'provider';
}

export function getOnboardingRolePreset(rolePresetId: string | null | undefined, options: { includeDisabled?: boolean } = {}) {
  const preset = AGENT_ONBOARDING_ROLE_PRESETS[normalizeOnboardingRolePreset(rolePresetId)];
  if (!preset.enabled && !options.includeDisabled) return null;
  return preset;
}

export function getOnboardingRolePresets(options: { includeDisabled?: boolean } = {}) {
  return Object.values(AGENT_ONBOARDING_ROLE_PRESETS).filter((item) => options.includeDisabled || item.enabled);
}
