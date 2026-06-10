import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { buildAgentManifest } from '@/lib/agent-onboarding/manifest-builder';

const upsertManifest = vi.fn();
const updateMetadataDraftServer = vi.fn();
const completeRegistrationIntent = vi.fn();

vi.mock('@/lib/mcp/session-auth', () => ({
  authenticateWalletRequest: vi.fn(async () => ({ authenticated: true, wallet: '0x0000000000000000000000000000000000000001' })),
}));

vi.mock('@/lib/contracts/erc8004', () => ({
  getERC8004OwnerOf: vi.fn(async () => '0x0000000000000000000000000000000000000001'),
}));

vi.mock('@/lib/agent-accounts/store', () => ({
  getActiveAgentAccountForOwnerAndAddress: vi.fn(async () => null),
}));

vi.mock('@/lib/agent-onboarding/registration-intents', () => ({
  getRegistrationIntent: vi.fn(async () => ({
    id: 'intent-1',
    mcpSessionId: 'session-1',
    ownerAddress: '0x0000000000000000000000000000000000000001',
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

describe('agent onboarding finalize route', () => {
  beforeEach(() => {
    upsertManifest.mockReset().mockResolvedValue({ ok: true });
    updateMetadataDraftServer.mockReset().mockResolvedValue({ ok: true });
    completeRegistrationIntent.mockReset().mockResolvedValue({ ok: true });
  });

  it('upserts the finalized manifest into agent_manifests', async () => {
    const { POST } = await import('./route');
    const manifest = buildAgentManifest({
      agentId: '123',
      name: 'Provider Agent',
      rolePresetId: 'provider',
      description: 'Performs ERC-8183 work and submits deliverables.',
      controller: '0x0000000000000000000000000000000000000001',
    });

    const req = new NextRequest('https://arclayers.xyz/api/agent-onboarding/finalize', {
      method: 'POST',
      body: JSON.stringify({
        intentId: 'intent-1',
        agentId: '123',
        txHash: '0x' + '1'.repeat(64),
        manifest,
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(updateMetadataDraftServer).toHaveBeenCalledWith(expect.objectContaining({ draftId: 'draft-1', agentId: '123' }));
    expect(upsertManifest).toHaveBeenCalledWith(expect.objectContaining({ agentId: '123', manifest }));
  });
});
