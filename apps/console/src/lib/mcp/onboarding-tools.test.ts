import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpSession } from '@/lib/agent-accounts/types';

const mocks = vi.hoisted(() => ({
  resolveMcpSessionByToken: vi.fn(),
  createMetadataDraft: vi.fn(),
  getMetadataDraft: vi.fn(),
  createRegistrationIntent: vi.fn(),
  getRegistrationIntent: vi.fn(),
  handleCreateApiKey: vi.fn(),
}));

vi.mock('@/lib/agent-accounts/store', () => ({
  resolveMcpSessionByToken: mocks.resolveMcpSessionByToken,
}));

vi.mock('@/lib/a2a/metadata-drafts/store', () => ({
  createMetadataDraft: mocks.createMetadataDraft,
  getMetadataDraft: mocks.getMetadataDraft,
}));

vi.mock('@/lib/agent-onboarding/registration-intents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-onboarding/registration-intents')>();
  return {
    ...actual,
    createRegistrationIntent: mocks.createRegistrationIntent,
    getRegistrationIntent: mocks.getRegistrationIntent,
  };
});

vi.mock('./api-key-tools', () => ({
  handleCreateApiKey: mocks.handleCreateApiKey,
}));

import {
  handleCreateAgentRuntimeKey,
  handleGetAgentBundleStatus,
  handleStartAgentBundle,
} from './onboarding-tools';
import type { McpToolContext } from './registry';

const OWNER = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
const SESSION: McpSession = {
  id: 'session-1',
  tokenHash: 'hash',
  ownerAddress: OWNER,
  agentAccountAddress: OWNER,
  permissions: {},
  autoApprove: false,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  revokedAt: null,
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  status: 'active',
};

const ctx: McpToolContext = {
  request: {
    origin: 'https://arclayers.xyz',
    method: 'POST',
    authorization: 'Bearer arc_mcp_sess_test',
  },
};

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    mcpSessionId: 'session-1',
    ownerAddress: OWNER.toLowerCase(),
    draftId: 'draft-1',
    rolePresetId: 'payment',
    status: 'draft',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    completedAt: null,
    agentId: null,
    txHash: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveMcpSessionByToken.mockResolvedValue(SESSION);
  mocks.createMetadataDraft.mockResolvedValue({ ok: true, draftId: 'draft-1', writeToken: 'secret-write-token' });
  mocks.createRegistrationIntent.mockResolvedValue({ ok: true, intent: intent() });
  mocks.getMetadataDraft.mockResolvedValue({
    draftId: 'draft-1',
    controller: OWNER,
    metadata: {},
    status: 'draft',
    agentId: null,
    txHash: null,
    updatedAt: new Date().toISOString(),
  });
  mocks.getRegistrationIntent.mockResolvedValue(intent());
  mocks.handleCreateApiKey.mockResolvedValue({
    ok: true,
    agentId: '123',
    keyPrefix: 'ak_test',
    key: 'ak_test_secret',
    scopes: ['agents:read', 'jobs:claim'],
    preset: 'provider',
    requestedPreset: 'payment',
    envSnippet: 'ARCLAYER_API_KEY=ak_test_secret',
  });
});

describe('MCP Agent Bundle onboarding tools', () => {
  it('starts an agent bundle by creating a draft, intent, role preset, readiness, and browser registration URL', async () => {
    const result = await handleStartAgentBundle({
      rolePresetId: 'payment',
      name: 'Payment Integration Bot',
      description: 'Handles x402 access and USDC settlement.',
      customCapabilities: ['receipts'],
    }, ctx) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      bundleStatus: 'draft',
      intentId: 'intent-1',
      draftId: 'draft-1',
      metadataURI: 'https://arclayers.xyz/api/a2a/metadata/draft/draft-1',
      registrationUrl: 'https://arclayers.xyz/register/erc8004?intent=intent-1&mcp=1',
      readiness: {
        erc8004: 'mint_required',
        manifest: 'draft_created',
        apiKey: 'after_mint',
      },
    });
    expect(result.rolePreset).toMatchObject({ id: 'payment', category: 'payment' });
    expect(JSON.stringify(result)).not.toContain('secret-write-token');
    expect(mocks.createMetadataDraft).toHaveBeenCalledWith(expect.objectContaining({ controller: OWNER }));
    expect(mocks.createRegistrationIntent).toHaveBeenCalledWith(expect.objectContaining({
      mcpSessionId: 'session-1',
      ownerAddress: OWNER,
      draftId: 'draft-1',
      rolePresetId: 'payment',
    }));
  });

  it('returns draft status for an unfinished registration intent without throwing', async () => {
    const result = await handleGetAgentBundleStatus({ intentId: 'intent-1' }, ctx) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      status: 'draft',
      completed: false,
      intentId: 'intent-1',
      draftId: 'draft-1',
      rolePresetId: 'payment',
      registrationUrl: 'https://arclayers.xyz/register/erc8004?intent=intent-1&mcp=1',
      metadataURI: 'https://arclayers.xyz/api/a2a/metadata/draft/draft-1',
      readiness: {
        erc8004: 'mint_required',
        apiKey: 'after_mint',
      },
    });
  });

  it('returns completed status with agent identity, manifest URI, and dashboard URL', async () => {
    mocks.getRegistrationIntent.mockResolvedValue(intent({
      status: 'completed',
      completedAt: new Date().toISOString(),
      agentId: '123',
      txHash: '0x' + '1'.repeat(64),
    }));

    const result = await handleGetAgentBundleStatus({ intentId: 'intent-1' }, ctx) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      completed: true,
      agentId: '123',
      txHash: '0x' + '1'.repeat(64),
      manifestURI: 'arclayer://manifest/123',
      dashboardUrl: 'https://arclayers.xyz/agents/123',
      readiness: {
        erc8004: 'minted',
        manifest: 'finalized',
        apiKey: 'ready_to_create',
      },
    });
  });

  it('rejects runtime key creation for a draft intent', async () => {
    await expect(handleCreateAgentRuntimeKey({ intentId: 'intent-1' }, ctx))
      .rejects.toThrow('Agent Bundle registration is not completed yet');
    expect(mocks.handleCreateApiKey).not.toHaveBeenCalled();
  });

  it('creates a runtime key for a completed intent through the existing provider.create_api_key handler', async () => {
    mocks.getRegistrationIntent.mockResolvedValue(intent({
      status: 'completed',
      completedAt: new Date().toISOString(),
      agentId: '123',
      txHash: '0x' + '1'.repeat(64),
    }));

    const result = await handleCreateAgentRuntimeKey({ intentId: 'intent-1' }, ctx) as Record<string, unknown>;

    expect(mocks.handleCreateApiKey).toHaveBeenCalledWith({
      agentId: '123',
      preset: 'payment',
      label: 'agent-bundle-payment',
    }, ctx);
    expect(result).toMatchObject({
      ok: true,
      agentId: '123',
      key: 'ak_test_secret',
      requestedPreset: 'payment',
      envSnippet: 'ARCLAYER_API_KEY=ak_test_secret',
      warning: 'Store the key now — it will not be shown again.',
    });
  });
});
