import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpSession } from '@/lib/agent-accounts/types';

const mocks = vi.hoisted(() => ({
  authenticateWalletRequest: vi.fn(),
  resolveMcpSessionByToken: vi.fn(),
  getActiveAgentAccountForOwnerAndAddress: vi.fn(),
  upsertAgentAccountForOwner: vi.fn(),
  createMcpSession: vi.fn(),
  getApprovalById: vi.fn(),
  getEffectiveStatus: vi.fn(),
  approveApprovalByWallet: vi.fn(),
  cancelApprovalByWallet: vi.fn(),
  submitApprovalByWallet: vi.fn(),
  confirmApprovalByWallet: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  getERC8004OwnerOf: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

vi.mock('@/lib/mcp/session-auth', () => ({
  authenticateWalletRequest: mocks.authenticateWalletRequest,
}));

vi.mock('@/lib/agent-accounts/store', () => ({
  resolveMcpSessionByToken: mocks.resolveMcpSessionByToken,
  getActiveAgentAccountForOwnerAndAddress: mocks.getActiveAgentAccountForOwnerAndAddress,
  upsertAgentAccountForOwner: mocks.upsertAgentAccountForOwner,
  createMcpSession: mocks.createMcpSession,
}));

vi.mock('@/lib/mcp/approvals', () => ({
  getApprovalById: mocks.getApprovalById,
  getEffectiveStatus: mocks.getEffectiveStatus,
  approveApprovalByWallet: mocks.approveApprovalByWallet,
  cancelApprovalByWallet: mocks.cancelApprovalByWallet,
  submitApprovalByWallet: mocks.submitApprovalByWallet,
  confirmApprovalByWallet: mocks.confirmApprovalByWallet,
}));

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

vi.mock('@/lib/contracts/erc8004', () => ({
  getERC8004OwnerOf: mocks.getERC8004OwnerOf,
}));

vi.mock('@/lib/a2a/auth', () => ({
  createApiKey: mocks.createApiKey,
  revokeApiKey: mocks.revokeApiKey,
}));

import { POST as createMcpSessionPost } from '@/app/api/mcp/sessions/create/route';
import { POST as approvalPost } from '@/app/api/mcp/approvals/[id]/page/route';
import { resolveIdentityAndBuild, validateWebHireInput } from '@/lib/erc8183-jobs/web-hire-contract';
import { handleCreateApiKey, resolveAgentOwnership } from './api-key-tools';
import { handleGetAgentAccount, handlePrepareRegisterAgent } from './identity-tools';

const OWNER = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
const AGENT_ACCOUNT = '0xb03141849F755b0a337b3352C2290fce66e0C6dD';
const PROVIDER_CTRL = '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8';
const EVALUATOR_CTRL = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

const SESSION: McpSession = {
  id: 'session-1',
  tokenHash: 'hash',
  ownerAddress: OWNER,
  agentAccountAddress: AGENT_ACCOUNT,
  permissions: {},
  autoApprove: false,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  revokedAt: null,
  createdAt: new Date().toISOString(),
  lastUsedAt: null,
  status: 'active',
};

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockAgentQuery(agent: Record<string, unknown> | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: agent, error: null }),
          })),
        })),
      })),
    })),
  };
}

function approval() {
  return {
    id: 'approval-1',
    action: 'identity.register',
    chainId: 5042002,
    toAddress: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    data: '0x',
    value: '0x0',
    summary: {},
    status: 'pending',
    ownerAddress: OWNER,
    agentAccountAddress: AGENT_ACCOUNT,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    txHash: null,
    error: null,
    approvedAt: null,
    cancelledAt: null,
    submittedAt: null,
    confirmedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MCP_AGENT_ACCOUNT_IDENTITY_ENABLED;
  delete process.env.AGENT_ACCOUNT_BACKEND_ENABLED;

  mocks.authenticateWalletRequest.mockResolvedValue({ authenticated: true, wallet: OWNER });
  mocks.resolveMcpSessionByToken.mockResolvedValue(SESSION);
  mocks.getActiveAgentAccountForOwnerAndAddress.mockResolvedValue({ id: 'acct-1' });
  mocks.createMcpSession.mockResolvedValue({
    token: 'arc_mcp_sess_test',
    session: {
      ...SESSION,
      agentAccountAddress: OWNER,
      permissions: { allowedContracts: ['ERC8004_IDENTITY_REGISTRY'], allowedActions: ['identity.register'] },
    },
  });
  mocks.getERC8004OwnerOf.mockResolvedValue(OWNER);
  mocks.createApiKey.mockResolvedValue({ ok: true, key: 'ak_test', keyPrefix: 'ak_test', id: 'key-1' });
  mocks.revokeApiKey.mockResolvedValue(true);
  mocks.getApprovalById.mockResolvedValue(approval());
  mocks.getEffectiveStatus.mockReturnValue('pending');
  mocks.cancelApprovalByWallet.mockImplementation(async (row) => ({ ok: true, approval: row }));
});

afterEach(() => {
  delete process.env.MCP_AGENT_ACCOUNT_IDENTITY_ENABLED;
  delete process.env.AGENT_ACCOUNT_BACKEND_ENABLED;
});

describe('MCP EOA-first session creation', () => {
  it('creates an EOA MCP session without agentAccountAddress', async () => {
    const res = await createMcpSessionPost(jsonRequest('http://localhost/api/mcp/sessions/create', { mode: 'eoa' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.session.mode).toBe('eoa');
    expect(data.session.agentAccountAddress).toBe(OWNER);
    expect(data.session.controllerAddress).toBe(OWNER);
    expect(data.session.signerAddress).toBe(OWNER);
    expect(mocks.createMcpSession).toHaveBeenCalledWith(expect.objectContaining({
      ownerAddress: OWNER,
      agentAccountAddress: OWNER,
    }));
  });

  it('does not upsert Agent Account bindings for EOA MCP sessions', async () => {
    await createMcpSessionPost(jsonRequest('http://localhost/api/mcp/sessions/create', {}));

    expect(mocks.upsertAgentAccountForOwner).not.toHaveBeenCalled();
  });

  it('blocks explicit Agent Account mode when MCP Agent Account identity is disabled', async () => {
    const res = await createMcpSessionPost(jsonRequest('http://localhost/api/mcp/sessions/create', {
      mode: 'agent-account',
      agentAccountAddress: AGENT_ACCOUNT,
    }));
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data).toMatchObject({ ok: false, error: 'agent_account_mcp_disabled' });
    expect(mocks.upsertAgentAccountForOwner).not.toHaveBeenCalled();
    expect(mocks.createMcpSession).not.toHaveBeenCalled();
  });
});

describe('MCP Agent Account identity tools disabled flag', () => {
  it('blocks identity tools before Agent Account validation', async () => {
    await expect(handleGetAgentAccount({}, { request: { authorization: 'Bearer arc_mcp_sess_test' } } as any))
      .rejects.toThrow('agent_account_mcp_disabled');
    await expect(handlePrepareRegisterAgent({ name: '' }, { request: { authorization: 'Bearer arc_mcp_sess_test' } } as any))
      .rejects.toThrow('agent_account_mcp_disabled');

    expect(mocks.resolveMcpSessionByToken).toHaveBeenCalled();
    expect(mocks.getActiveAgentAccountForOwnerAndAddress).not.toHaveBeenCalled();
  });
});

describe('MCP approval URL disabled guard', () => {
  it.each(['approve', 'submit', 'confirm'])('blocks %s while Agent Account MCP identity is disabled', async (action) => {
    const res = await approvalPost(
      jsonRequest('http://localhost/api/mcp/approvals/approval-1/page', { action, txHash: '0xabc' }),
      { params: Promise.resolve({ id: 'approval-1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data).toMatchObject({ ok: false, error: 'agent_account_mcp_disabled' });
    expect(mocks.getApprovalById).not.toHaveBeenCalled();
  });

  it('allows cancel while Agent Account MCP identity is disabled', async () => {
    const res = await approvalPost(
      jsonRequest('http://localhost/api/mcp/approvals/approval-1/page', { action: 'cancel' }),
      { params: Promise.resolve({ id: 'approval-1' }) },
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mocks.cancelApprovalByWallet).toHaveBeenCalled();
  });
});

describe('MCP API key ownership in EOA mode', () => {
  it('accepts an EOA-controlled agent when Agent Account backend is disabled', async () => {
    mocks.getSupabaseAdmin.mockReturnValue(mockAgentQuery({ agent_id: 'agent-1', token_id: '1', controller: OWNER }));

    await expect(resolveAgentOwnership(SESSION, 'agent-1')).resolves.toMatchObject({ agent_id: 'agent-1' });
    expect(mocks.getActiveAgentAccountForOwnerAndAddress).not.toHaveBeenCalled();
  });



  it('falls back to ERC-8004 ownerOf for a just-minted numeric agent before indexer sync', async () => {
    mocks.getSupabaseAdmin.mockReturnValue(mockAgentQuery(null));
    mocks.getERC8004OwnerOf.mockResolvedValue(OWNER);

    await expect(resolveAgentOwnership(SESSION, '123')).resolves.toMatchObject({
      agent_id: '123',
      token_id: '123',
      controller: OWNER.toLowerCase(),
      source: 'onchain_owner_fallback',
    });
  });


  it('provider.create_api_key succeeds via ownerOf fallback before indexer sync', async () => {
    mocks.getSupabaseAdmin.mockReturnValue(mockAgentQuery(null));
    mocks.getERC8004OwnerOf.mockResolvedValue(OWNER);

    const result = await handleCreateApiKey(
      { agentId: '123', preset: 'provider' },
      { request: { authorization: 'Bearer arc_mcp_sess_test', origin: 'http://localhost', method: 'POST' } },
    ) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect(result.agentId).toBe('123');
    expect(mocks.createApiKey).toHaveBeenCalledWith(expect.objectContaining({ agentId: '123' }));
  });

  it('rejects ownerOf fallback when the MCP session does not control the on-chain owner', async () => {
    mocks.getSupabaseAdmin.mockReturnValue(mockAgentQuery(null));
    mocks.getERC8004OwnerOf.mockResolvedValue(PROVIDER_CTRL);

    await expect(resolveAgentOwnership(SESSION, '123')).rejects.toThrow(`Session does not control agent 123. Controller: ${PROVIDER_CTRL.toLowerCase()}`);
  });

  it('rejects an Agent Account-controlled agent when Agent Account backend is disabled', async () => {
    mocks.getSupabaseAdmin.mockReturnValue(mockAgentQuery({ agent_id: 'agent-1', token_id: '1', controller: AGENT_ACCOUNT }));

    await expect(resolveAgentOwnership(SESSION, 'agent-1')).rejects.toThrow('agent_account_controller_disabled');
    expect(mocks.getActiveAgentAccountForOwnerAndAddress).not.toHaveBeenCalled();
  });
});

describe('ERC-8183 direct hire Agent Account controller guard', () => {
  function validWebHire() {
    return validateWebHireInput({
      settlementMode: 'erc8183_escrow',
      buyerAgentId: 'buyer-1',
      providerAgentId: 'provider-1',
      evaluatorAgentId: 'evaluator-1',
      budgetAtomic: '2000000',
      expiredAtUnix: String(Math.floor(Date.now() / 1000) + 3600),
      description: 'Test hire',
      inputPayload: { task: 'analyze' },
    });
  }

  it.each([
    ['provider', PROVIDER_CTRL],
    ['evaluator', EVALUATOR_CTRL],
  ])('rejects Agent Account-controlled %s while backend is disabled', async (_role, disabledController) => {
    const validated = validWebHire();
    if (!validated.ok) throw new Error(validated.detail);

    const result = await resolveIdentityAndBuild(
      validated,
      async (agentId) => ({
        'buyer-1': OWNER,
        'provider-1': PROVIDER_CTRL,
        'evaluator-1': EVALUATOR_CTRL,
      })[agentId] ?? null,
      async (controller) => controller === disabledController ? { id: 'acct-1' } : null,
    );

    expect(result).toMatchObject({
      ok: false,
      error: 'agent_account_controller_disabled',
      detail: 'This agent is controlled by Agent Account. Select or register an EOA-controlled agent for ERC-8183 jobs.',
    });
  });
});
