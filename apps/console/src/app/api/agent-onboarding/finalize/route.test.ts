import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildAgentManifest } from '@/lib/agent-onboarding/manifest-builder';

const OWNER = '0x0000000000000000000000000000000000000001';
const OTHER = '0x0000000000000000000000000000000000000002';

const upsertManifest = vi.fn();
const updateMetadataDraftServer = vi.fn();
const completeRegistrationIntent = vi.fn();
const getERC8004OwnerOf = vi.fn();
const getERC8004MintedTokenIdFromTxHash = vi.fn();

vi.mock('@/lib/mcp/session-auth', () => ({
  authenticateWalletRequest: vi.fn(async () => ({ authenticated: true, wallet: OWNER })),
}));

vi.mock('@/lib/contracts/erc8004', () => ({
  getERC8004OwnerOf,
  getERC8004MintedTokenIdFromTxHash,
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
    getERC8004MintedTokenIdFromTxHash.mockReset().mockResolvedValue(123n);
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
    expect(completeRegistrationIntent.mock.invocationCallOrder[0]).toBeLessThan(updateMetadataDraftServer.mock.invocationCallOrder[0]);
    expect(completeRegistrationIntent.mock.invocationCallOrder[0]).toBeLessThan(upsertManifest.mock.invocationCallOrder[0]);
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


  it('rejects finalize when tx receipt cannot be verified', async () => {
    const { POST } = await import('./route');
    getERC8004MintedTokenIdFromTxHash.mockRejectedValue(new Error('not found'));
    const manifest = buildAgentManifest({
      agentId: '123',
      name: 'Provider Agent',
      rolePresetId: 'provider',
      description: 'Performs ERC-8183 work and submits deliverables.',
      controller: OWNER,
    });

    const res = await POST(finalizeRequest(manifest));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('tx_receipt_invalid');
    expect(upsertManifest).not.toHaveBeenCalled();
  });

  it('rejects finalize when tx receipt minted a different tokenId', async () => {
    const { POST } = await import('./route');
    getERC8004MintedTokenIdFromTxHash.mockResolvedValue(999n);
    const manifest = buildAgentManifest({
      agentId: '123',
      name: 'Provider Agent',
      rolePresetId: 'provider',
      description: 'Performs ERC-8183 work and submits deliverables.',
      controller: OWNER,
    });

    const res = await POST(finalizeRequest(manifest));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('tx_agentId_mismatch');
    expect(upsertManifest).not.toHaveBeenCalled();
  });

  it('repairs side effects for a double-finalize with the same agentId and txHash', async () => {
    const registrationIntents = await import('@/lib/agent-onboarding/registration-intents');
    vi.mocked(registrationIntents.getRegistrationIntent).mockResolvedValueOnce({
      id: 'intent-1',
      mcpSessionId: 'session-1',
      ownerAddress: OWNER,
      draftId: 'draft-1',
      rolePresetId: 'provider',
      status: 'completed',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      completedAt: new Date().toISOString(),
      agentId: '123',
      txHash: '0x' + '1'.repeat(64),
    });
    completeRegistrationIntent.mockResolvedValueOnce({ ok: true, idempotent: true });
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

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, idempotent: true, agentId: '123' });
    expect(getERC8004MintedTokenIdFromTxHash).toHaveBeenCalled();
    expect(updateMetadataDraftServer).toHaveBeenCalled();
    expect(upsertManifest).toHaveBeenCalled();
  });

  it('returns conflict for a completed intent with different finalize values', async () => {
    const registrationIntents = await import('@/lib/agent-onboarding/registration-intents');
    vi.mocked(registrationIntents.getRegistrationIntent).mockResolvedValueOnce({
      id: 'intent-1',
      mcpSessionId: 'session-1',
      ownerAddress: OWNER,
      draftId: 'draft-1',
      rolePresetId: 'provider',
      status: 'completed',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      completedAt: new Date().toISOString(),
      agentId: '999',
      txHash: '0x' + '2'.repeat(64),
    });
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

    expect(res.status).toBe(409);
    expect(json.error).toBe('intent_complete_conflict');
    expect(upsertManifest).not.toHaveBeenCalled();
  });


  it('returns conflict before draft or manifest side effects when atomic intent completion loses a race', async () => {
    const { POST } = await import('./route');
    completeRegistrationIntent.mockResolvedValueOnce({ ok: false, conflict: true, error: 'intent_complete_conflict' });
    const manifest = buildAgentManifest({
      agentId: '123',
      name: 'Provider Agent',
      rolePresetId: 'provider',
      description: 'Performs ERC-8183 work and submits deliverables.',
      controller: OWNER,
    });

    const res = await POST(finalizeRequest(manifest));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('intent_complete_conflict');
    expect(updateMetadataDraftServer).not.toHaveBeenCalled();
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
    expect(typeof savedManifest.updatedAt).toBe('string');
    expect(updateMetadataDraftServer).toHaveBeenCalledWith(expect.objectContaining({ metadata: savedManifest }));
    expect(upsertManifest).toHaveBeenCalledWith(expect.objectContaining({ manifest: savedManifest }));
  });
});
