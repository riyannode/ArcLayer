import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildAgentManifest } from '@/lib/agent-onboarding/manifest-builder';

const OWNER = '0x0000000000000000000000000000000000000001';
const OTHER = '0x0000000000000000000000000000000000000002';

const upsertManifest = vi.fn();
const updateMetadataDraftServer = vi.fn();
const completeRegistrationIntent = vi.fn();
const getERC8004OwnerOf = vi.fn();

vi.mock('@/lib/mcp/session-auth', () => ({
  authenticateWalletRequest: vi.fn(async () => ({ authenticated: true, wallet: OWNER })),
}));

vi.mock('@/lib/contracts/erc8004', () => ({
  getERC8004OwnerOf,
}));

vi.mock('@/lib/agent-accounts/store', () => ({
  getActiveAgentAccountForOwnerAndAddress: vi.fn(async () => null),
}));

vi.mock('@/lib/agent-onboarding/registration-intents', () => ({
  getRegistrationIntent: vi.fn(async () => ({
    id: 'intent-1',
    mcpSessionId: 'session-1',
    ownerAddress: OWNER,
    draftId: 'draft-1',
    rolePresetId: 'provider',
    status: 'draft',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    completedAt: null,
    agentId: null,
    txHash: null,
  })),
  completeRegistrationIntent,
}));

vi.mock('@/lib/a2a/metadata-drafts/store', () => ({
  updateMetadataDraftServer,
}));

vi.mock('@/lib/a2a/manifest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a2a/manifest')>();
  return {
    ...actual,
    upsertManifest,
  };
});

function finalizeRequest(manifest: unknown) {
  return new NextRequest('https://arclayers.xyz/api/agent-onboarding/finalize', {
    method: 'POST',
    body: JSON.stringify({
      intentId: 'intent-1',
      agentId: '123',
      txHash: '0x' + '1'.repeat(64),
      manifest,
    }),
  });
}

describe('agent onboarding finalize route', () => {
  beforeEach(() => {
    upsertManifest.mockReset().mockResolvedValue({ ok: true });
    updateMetadataDraftServer.mockReset().mockResolvedValue({ ok: true });
    completeRegistrationIntent.mockReset().mockResolvedValue({ ok: true });
    getERC8004OwnerOf.mockReset().mockResolvedValue(OWNER);
  });

  it('upserts the finalized manifest into agent_manifests', async () => {
    const { POST } = await import('./route');
    const manifest = buildAgentManifest({
      agentId: '123',
      name: 'Provider Agent',
      rolePresetId: 'provider',
      description: 'Performs ERC-8183 work and submits deliverables.',
      controller: OWNER,
    });

    const res = await POST(finalizeRequest(manifest));
    const json = await res.json();
    const savedManifest = upsertManifest.mock.calls[0][0].manifest;

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(savedManifest.controller).toBe(OWNER);
    expect(updateMetadataDraftServer).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'draft-1', agentId: '123', metadata: savedManifest }));
    expect(upsertManifest).toHaveBeenCalledWith(expect.objectContaining({ agentId: '123', manifest: savedManifest }));
  });

  it('rejects a manifest controller that differs from ERC-8004 ownerOf(agentId)', async () => {
    const { POST } = await import('./route');
    const manifest = buildAgentManifest({
      agentId: '123',
      name: 'Provider Agent',
      rolePresetId: 'provider',
      description: 'Performs ERC-8183 work and submits deliverables.',
      controller: OTHER,
    });

    const res = await POST(finalizeRequest(manifest));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('manifest_controller_mismatch');
    expect(upsertManifest).not.toHaveBeenCalled();
  });

  it('accepts an omitted manifest controller and canonicalizes to ERC-8004 ownerOf(agentId)', async () => {
    const { POST } = await import('./route');
    const manifest = buildAgentManifest({
      agentId: '123',
      name: 'Provider Agent',
      rolePresetId: 'provider',
      description: 'Performs ERC-8183 work and submits deliverables.',
    });

    const res = await POST(finalizeRequest(manifest));
    const json = await res.json();
    const savedManifest = upsertManifest.mock.calls[0][0].manifest;

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(savedManifest.controller).toBe(OWNER);
    expect(savedManifest.updatedAt).not.toBe(manifest.updatedAt);
    expect(updateMetadataDraftServer).toHaveBeenCalledWith(expect.objectContaining({ metadata: savedManifest }));
    expect(upsertManifest).toHaveBeenCalledWith(expect.objectContaining({ manifest: savedManifest }));
  });
});
