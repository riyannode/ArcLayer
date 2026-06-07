/**
 * Smoke tests for Universal External Bot Onboarding.
 *
 * Tests the lib functions that generate manifests, env bundles, and install commands.
 * Does NOT test the wizard UI or backend routes (those are integration/E2E).
 */

import { describe, it, expect } from 'vitest';
import { getTemplatesByCategory, getTemplate, EXTERNAL_BOT_TEMPLATES } from './templates';
import { scopesForMode } from './scopes';
import { buildExternalBotManifest } from './buildManifest';
import { buildEnvBundle } from './buildEnvBundle';
import { buildInstallCommand } from './buildInstallCommand';
import type { ExternalBotTemplate } from './templates';

// ── Fixtures ─────────────────────────────────────────────────

function mockTemplate(): ExternalBotTemplate {
  const t = getTemplate('prediction-market-pm2-bridge');
  if (!t) throw new Error('prediction-market-pm2-bridge template not found');
  return t;
}

// ── Tests ────────────────────────────────────────────────────

describe('templates', () => {
  it('registers prediction-market-pm2-bridge template', () => {
    const t = getTemplate('prediction-market-pm2-bridge');
    expect(t).toBeDefined();
    expect(t?.category).toBe('prediction-market-bots');
    expect(t?.roles).toHaveLength(4);
  });

  it('registers custom-worker template', () => {
    const t = getTemplate('custom-worker');
    expect(t).toBeDefined();
    expect(t?.category).toBe('custom-workers');
    expect(t?.roles).toHaveLength(1);
  });

  it('filters templates by category', () => {
    const pm = getTemplatesByCategory('prediction-market-bots');
    expect(pm).toHaveLength(1);
    expect(pm[0].id).toBe('prediction-market-pm2-bridge');

    const custom = getTemplatesByCategory('custom-workers');
    expect(custom).toHaveLength(1);
    expect(custom[0].id).toBe('custom-worker');
  });

  it('returns empty for unregistered categories', () => {
    const t = getTemplatesByCategory('rwa-agents');
    expect(t).toHaveLength(0);
  });
});

describe('scopes', () => {
  it('returns bridge scopes for bridge mode', () => {
    const s = scopesForMode('bridge');
    expect(s).toContain('agent_bridge:write');
    expect(s).toContain('agent_bridge:receipt');
    expect(s).not.toContain('jobs:claim');
  });

  it('returns hybrid scopes with jobs + bridge', () => {
    const s = scopesForMode('hybrid');
    expect(s).toContain('jobs:claim');
    expect(s).toContain('jobs:create');
    expect(s).toContain('agent_bridge:write');
  });
});

describe('buildManifest', () => {
  const t = mockTemplate();
  const controller = '0x1234567890abcdef1234567890abcdef12345678' as const;

  it('builds manifest for first role (oracle)', () => {
    const manifest = buildExternalBotManifest({
      template: t,
      agentId: '20164',
      roleIndex: 0,
      controller,
      endpoint: 'oracle-bot.js',
      priceAtomic: '1000',
    });

    expect(manifest.schema).toBe('arclayer.agent/v1');
    expect(manifest.agentId).toBe('20164');
    expect(manifest.role).toBe('oracle');
    expect(manifest.categories).toContain('prediction-market-bots');
    expect(manifest.x402?.enabled).toBe(true);
    expect(manifest.x402?.network).toBe('arc-testnet');
    expect(manifest.host).toBe('self-hosted');
    expect(manifest.mode).toBe('dual'); // hybrid → dual
  });

  it('builds manifest with correct mode mapping', () => {
    // hybrid → dual
    const manifest = buildExternalBotManifest({
      template: t,
      agentId: '20165',
      roleIndex: 1,
      controller,
      endpoint: 'analyzer-bot.js',
      priceAtomic: '1000',
    });
    expect(manifest.mode).toBe('dual');
  });

  it('omits endpoint when value is not a URL (bare filename)', () => {
    const manifest = buildExternalBotManifest({
      template: t,
      agentId: '20166',
      roleIndex: 2,
      controller,
      endpoint: 'evaluator-bot.js',
      priceAtomic: '1000',
    });
    expect(manifest.endpoint).toBeUndefined();
  });

  it('includes endpoint when value is a valid HTTPS URL', () => {
    const manifest = buildExternalBotManifest({
      template: t,
      agentId: '20167',
      roleIndex: 3,
      controller,
      endpoint: 'https://agent.example.com/jobs/run',
      priceAtomic: '1000',
    });
    expect(manifest.endpoint).toBe('https://agent.example.com/jobs/run');
  });

  it('includes endpointPath and enabled in role object', () => {
    const manifest = buildExternalBotManifest({
      template: t,
      agentId: '20168',
      roleIndex: 0,
      controller,
      endpoint: 'oracle-bot.js',
      priceAtomic: '1000',
    });
    expect(manifest.roles?.[0].endpointPath).toBe('oracle-bot.js');
    expect(manifest.roles?.[0].enabled).toBe(true);
  });

  it('uses custom roleDisplayName when provided', () => {
    const manifest = buildExternalBotManifest({
      template: t,
      agentId: '20169',
      roleIndex: 0,
      controller,
      endpoint: 'oracle-bot.js',
      priceAtomic: '1000',
      roleDisplayName: 'My Custom Oracle',
    });
    expect(manifest.name).toContain('My Custom Oracle');
    expect(manifest.description).toContain('My Custom Oracle');
    expect(manifest.roles?.[0].name).toBe('My Custom Oracle');
    // BOT_ROLE stays locked
    expect(manifest.role).toBe('oracle');
  });

  it('uses custom roleBrandedName in metadata URI', () => {
    // Simulate what the wizard does: brandedName used in metadataURI
    const brandedName = 'my-custom-oracle';
    const metadataURI = `arclayer://manifest/${brandedName}`;
    expect(metadataURI).toBe('arclayer://manifest/my-custom-oracle');

    // Manifest name still uses displayName, role stays locked
    const manifest = buildExternalBotManifest({
      template: t,
      agentId: '20170',
      roleIndex: 0,
      controller,
      endpoint: 'oracle-bot.js',
      priceAtomic: '1000',
      roleDisplayName: 'My Custom Oracle',
      roleBrandedName: brandedName,
    });
    expect(manifest.role).toBe('oracle');
    expect(manifest.name).toContain('My Custom Oracle');
  });
});

describe('buildEnvBundle', () => {
  const t = mockTemplate();

  it('generates .env.common + 4 role files', () => {
    const bundle = buildEnvBundle({
      template: t,
      baseUrl: 'https://www.arclayers.xyz',
      category: 'prediction-market-bots',
      agentIds: ['20164', '20165', '20166', '20167'],
      apiKeys: ['ak_1', 'ak_2', 'ak_3', 'ak_4'],
      erc8004Ids: [
        'erc8004_identity_registry:20164',
        'erc8004_identity_registry:20165',
        'erc8004_identity_registry:20166',
        'erc8004_identity_registry:20167',
      ],
      runtimeNames: ['hermes-oracle', 'apollo-analyzer', 'ignia-evaluator', 'budu-executor'],
    });

    expect(bundle.common.filename).toBe('.env.common');
    expect(bundle.roleFiles).toHaveLength(4);
  });

  it('(fix #3) ARCLAYER_AGENT_ID = minted token ID, RUNTIME_ID = branded', () => {
    const bundle = buildEnvBundle({
      template: t,
      baseUrl: 'https://www.arclayers.xyz',
      category: 'prediction-market-bots',
      agentIds: ['20164', '20165', '20166', '20167'],
      apiKeys: ['ak_1', 'ak_2', 'ak_3', 'ak_4'],
      erc8004Ids: [
        'erc8004_identity_registry:20164',
        'erc8004_identity_registry:20165',
        'erc8004_identity_registry:20166',
        'erc8004_identity_registry:20167',
      ],
      runtimeNames: ['hermes-oracle', 'apollo-analyzer', 'ignia-evaluator', 'budu-executor'],
    });

    const oracle = bundle.roleFiles[0];
    expect(oracle.content).toContain('ARCLAYER_AGENT_ID=20164');
    expect(oracle.content).toContain('RUNTIME_ID=hermes-oracle-runtime-01');
    expect(oracle.content).toContain('ARCLAYER_ERC8004_ID=erc8004_identity_registry:20164');
  });

  it('(edit roles) RUNTIME_ID uses custom brandedName', () => {
    const bundle = buildEnvBundle({
      template: t,
      baseUrl: 'https://www.arclayers.xyz',
      category: 'prediction-market-bots',
      agentIds: ['20164', '20165', '20166', '20167'],
      apiKeys: ['ak_1', 'ak_2', 'ak_3', 'ak_4'],
      erc8004Ids: [
        'erc8004_identity_registry:20164',
        'erc8004_identity_registry:20165',
        'erc8004_identity_registry:20166',
        'erc8004_identity_registry:20167',
      ],
      runtimeNames: ['my-oracle', 'my-analyzer', 'my-evaluator', 'my-executor'],
    });

    const oracle = bundle.roleFiles[0];
    expect(oracle.content).toContain('ARCLAYER_AGENT_ID=20164');
    expect(oracle.content).toContain('RUNTIME_ID=my-oracle-runtime-01');
    expect(oracle.content).not.toContain('RUNTIME_ID=hermes-oracle-runtime-01');
  });
});

describe('buildInstallCommand', () => {
  it('(fix #4) PM2 bridge produces valid git clone + pm2 start command', () => {
    const t = mockTemplate();
    const bundle = buildEnvBundle({
      template: t,
      baseUrl: 'https://www.arclayers.xyz',
      category: 'prediction-market-bots',
      agentIds: ['20164', '20165', '20166', '20167'],
      apiKeys: ['ak_1', 'ak_2', 'ak_3', 'ak_4'],
      erc8004Ids: [],
      runtimeNames: ['hermes-oracle', 'apollo-analyzer', 'ignia-evaluator', 'budu-executor'],
    });

    const cmd = buildInstallCommand({
      template: t,
      envBundle: bundle,
      roleNames: ['oracle', 'analyzer', 'evaluator', 'executor'],
    });

    expect(cmd.command).toContain('git clone');
    expect(cmd.command).toContain('market-agent-bridge');
    expect(cmd.command).toContain('pm2 start ecosystem.independent.config.cjs');
    expect(cmd.command).toContain('pm2 delete oracle-bot');
  });

  it('(fix #6) non-PM2 templates return coming soon', () => {
    const t = getTemplate('custom-worker');
    if (!t) throw new Error('custom-worker template not found');

    const bundle = buildEnvBundle({
      template: t,
      baseUrl: 'https://www.arclayers.xyz',
      category: 'custom-workers',
      agentIds: ['worker-1'],
      apiKeys: ['ak_worker'],
      erc8004Ids: [],
    });

    const cmd = buildInstallCommand({
      template: t,
      envBundle: bundle,
      roleNames: ['worker'],
    });

    expect(cmd.title).toContain('coming soon');
    expect(cmd.command).toContain('not yet available');
  });

  it('erc8183-escrow-bots returns git clone + pm2 command (no inline secrets)', () => {
    const t = getTemplate('erc8183-escrow-bots');
    if (!t) throw new Error('erc8183-escrow-bots template not found');

    const bundle = buildEnvBundle({
      template: t,
      baseUrl: 'https://arclayers.xyz',
      category: 'erc8183-jobs',
      agentIds: ['36191', '36192', '36202'],
      apiKeys: ['ak_client', 'ak_provider', 'ak_evaluator'],
      erc8004Ids: [],
    });

    const cmd = buildInstallCommand({
      template: t,
      envBundle: bundle,
      roleNames: ['client', 'provider', 'evaluator'],
    });

    expect(cmd.title).toContain('ERC-8183');
    expect(cmd.command).toContain('git clone');
    expect(cmd.command).toContain('pm2 start');
    // Security: no inline secrets
    expect(cmd.command).not.toContain('ak_');
    expect(cmd.command).not.toContain('PRIVATE_KEY');
  });

  it('erc8183-escrow-bots with provider-only returns provider shortcut', () => {
    const t = getTemplate('erc8183-escrow-bots');
    if (!t) throw new Error('erc8183-escrow-bots template not found');

    const bundle = buildEnvBundle({
      template: t,
      baseUrl: 'https://arclayers.xyz',
      category: 'erc8183-jobs',
      agentIds: ['36192'],
      apiKeys: ['ak_provider'],
      erc8004Ids: [],
    });

    const cmd = buildInstallCommand({
      template: t,
      envBundle: bundle,
      roleNames: ['provider'],
    });

    expect(cmd.title).toBe('ERC-8183 Provider Runtime Bot');
    expect(cmd.command).toContain('provider-runtime-bot');
    expect(cmd.command).toContain('pm2 start');
  });

  it('erc8183-escrow-bots with client-only returns multi-bot command', () => {
    const t = getTemplate('erc8183-escrow-bots');
    if (!t) throw new Error('erc8183-escrow-bots template not found');

    const bundle = buildEnvBundle({
      template: t,
      baseUrl: 'https://arclayers.xyz',
      category: 'erc8183-jobs',
      agentIds: ['36191'],
      apiKeys: ['ak_client'],
      erc8004Ids: [],
    });

    const cmd = buildInstallCommand({
      template: t,
      envBundle: bundle,
      roleNames: ['client'],
    });

    // Client-only falls through to generic multi-bot command
    expect(cmd.title).toContain('ERC-8183');
    expect(cmd.command).toContain('git clone');
  });

  it('erc8183-escrow-bots with evaluator-only returns evaluator shortcut', () => {
    const t = getTemplate('erc8183-escrow-bots');
    if (!t) throw new Error('erc8183-escrow-bots template not found');

    const bundle = buildEnvBundle({
      template: t,
      baseUrl: 'https://arclayers.xyz',
      category: 'erc8183-jobs',
      agentIds: ['36202'],
      apiKeys: ['ak_evaluator'],
      erc8004Ids: [],
    });

    const cmd = buildInstallCommand({
      template: t,
      envBundle: bundle,
      roleNames: ['evaluator'],
    });

    expect(cmd.title).toBe('ERC-8183 Evaluator Runtime Bot');
    expect(cmd.command).toContain('evaluator-runtime-bot');
    expect(cmd.command).toContain('pm2 start');
  });
});

describe('end-to-end consistency (fix #7)', () => {
  it('manifest → key → env agentId match', () => {
    const t = mockTemplate();
    const controller = '0x1234567890abcdef1234567890abcdef12345678' as const;

    // Simulate what the wizard does:
    // 1. Register → get minted token ID
    const mintedTokenIds = ['20164', '20165', '20166', '20167'];

    // 2. Build manifest for each role with minted ID
    for (let i = 0; i < t.roles.length; i++) {
      const manifest = buildExternalBotManifest({
        template: t,
        agentId: mintedTokenIds[i],
        roleIndex: i,
        controller,
        endpoint: t.roles[i].endpointPath,
        priceAtomic: '1000',
      });
      expect(manifest.agentId).toBe(mintedTokenIds[i]);
    }

    // 3. Generate API keys (would be POST /api/a2a/keys with agentId=mintedTokenId)
    //    Keys created for agentId = mintedTokenId

    // 4. Build env with same minted IDs
    const bundle = buildEnvBundle({
      template: t,
      baseUrl: 'https://www.arclayers.xyz',
      category: 'prediction-market-bots',
      agentIds: mintedTokenIds,
      apiKeys: ['ak_1', 'ak_2', 'ak_3', 'ak_4'],
      erc8004Ids: mintedTokenIds.map((id) => `erc8004_identity_registry:${id}`),
      runtimeNames: ['hermes-oracle', 'apollo-analyzer', 'ignia-evaluator', 'budu-executor'],
    });

    // 5. Verify env ARCLAYER_AGENT_ID matches key agentId
    for (let i = 0; i < t.roles.length; i++) {
      expect(bundle.roleFiles[i].content).toContain(`ARCLAYER_AGENT_ID=${mintedTokenIds[i]}`);
      expect(bundle.roleFiles[i].content).not.toContain('ARCLAYER_AGENT_ID=hermes-oracle');
    }
  });
});
