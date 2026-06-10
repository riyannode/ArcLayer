import { describe, expect, it } from 'vitest';
import { isErc8183CommerceAgent } from '@/lib/dashboard/erc8183-agents';
import { buildAgentManifest } from './manifest-builder';
import { getOnboardingRolePresets } from './role-presets';
import { parseManifest } from '@/lib/a2a/manifest/parse';

const lifecycleCapabilities = [
  'claim_job',
  'submit_work',
  'job-creation',
  'escrow',
  'create_job',
  'fund_escrow',
  'approve_result',
  'settle_job',
  'evaluate_work',
  'complete_job',
];

describe('agent onboarding role presets', () => {
  it('keeps enabled presets dashboard-safe for ERC-8183 commerce', () => {
    for (const preset of getOnboardingRolePresets()) {
      expect(preset.categories).toContain('erc8183-commerce');
      expect(preset.tags).toEqual(expect.arrayContaining(['erc8183', 'erc8183-commerce', 'agentic-commerce']));
      expect(preset.capabilities.some((cap) => lifecycleCapabilities.includes(cap))).toBe(true);
    }
  });

  it('builds manifests that parse and match dashboard ERC-8183 filters', () => {
    for (const preset of getOnboardingRolePresets()) {
      const manifest = buildAgentManifest({
        agentId: '123',
        name: preset.title,
        rolePresetId: preset.id,
        description: preset.description,
        controller: '0x0000000000000000000000000000000000000001',
      });

      expect(parseManifest(manifest).ok).toBe(true);
      expect(isErc8183CommerceAgent({ metadata: manifest })).toBe(true);
    }
  });
});
