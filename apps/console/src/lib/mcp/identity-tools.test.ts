import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpSession } from '@/lib/agent-accounts/types';
import type { McpToolContext } from './registry';

const mockResolveMcpSessionByToken = vi.fn();
const mockGetActiveAgentAccountForOwnerAndAddress = vi.fn();
const mockCreateApproval = vi.fn();
const mockGetApproval = vi.fn();
const mockGetEffectiveStatus = vi.fn();

vi.mock('@/lib/agent-accounts/store', () => ({
  resolveMcpSessionByToken: mockResolveMcpSessionByToken,
  getActiveAgentAccountForOwnerAndAddress: mockGetActiveAgentAccountForOwnerAndAddress,
}));

vi.mock('@/lib/mcp/approvals', () => ({
  createApproval: mockCreateApproval,
  getApproval: mockGetApproval,
  getEffectiveStatus: mockGetEffectiveStatus,
}));

const {
  handleGetAgentAccount,
  handlePrepareRegisterAgent,
  handleRequestRegisterAgentApproval,
  handleGetRegistrationStatus,
} = await import('./identity-tools');

const session: McpSession = {
  id: 'mcp_sess_1',
  tokenHash: 'token_hash_1',
  ownerAddress: '0x1111111111111111111111111111111111111111',
  agentAccountAddress: '0x2222222222222222222222222222222222222222',
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
    origin: 'test',
    method: 'tools/call',
    authorization: 'Bearer arc_mcp_sess_existing',
  },
};

const metadata = {
  name: 'Test Agent',
  role: 'agent',
  capabilities: ['analysis'],
  description: 'Test identity metadata',
};

function expectDisabledError(error: unknown) {
  expect(error).toMatchObject({
    name: 'McpError',
    code: 'FORBIDDEN',
    message: expect.stringContaining('agent_account_mcp_disabled'),
  });
}

describe('MCP identity Agent Account feature flag guard', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mockResolveMcpSessionByToken.mockResolvedValue(session);
    mockGetActiveAgentAccountForOwnerAndAddress.mockResolvedValue({
      id: 'agent_account_1',
      ownerAddress: session.ownerAddress,
      agentAccountAddress: session.agentAccountAddress,
      walletProvider: 'circle',
      accountType: 'smart_account',
      chainId: 5042002,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockGetEffectiveStatus.mockReturnValue('awaiting_approval');
  });

  it('blocks existing sessions from reading Agent Account identity tools when disabled', async () => {
    vi.stubEnv('MCP_AGENT_ACCOUNT_IDENTITY_ENABLED', 'false');

    await expect(handleGetAgentAccount({}, ctx)).rejects.toSatisfy((error: unknown) => {
      expectDisabledError(error);
      return true;
    });
    await expect(handleGetRegistrationStatus({ approvalId: 'approval_1' }, ctx)).rejects.toSatisfy((error: unknown) => {
      expectDisabledError(error);
      return true;
    });

    expect(mockResolveMcpSessionByToken).toHaveBeenCalledTimes(2);
    expect(mockGetActiveAgentAccountForOwnerAndAddress).not.toHaveBeenCalled();
    expect(mockGetApproval).not.toHaveBeenCalled();
  });

  it('blocks existing sessions from preparing register calldata before metadata validation when disabled', async () => {
    vi.stubEnv('MCP_AGENT_ACCOUNT_IDENTITY_ENABLED', 'false');

    await expect(handlePrepareRegisterAgent({}, ctx)).rejects.toSatisfy((error: unknown) => {
      expectDisabledError(error);
      return true;
    });

    expect(mockResolveMcpSessionByToken).toHaveBeenCalledTimes(1);
    expect(mockGetActiveAgentAccountForOwnerAndAddress).not.toHaveBeenCalled();
  });

  it('blocks existing sessions from creating register approvals before approval creation when disabled', async () => {
    vi.stubEnv('MCP_AGENT_ACCOUNT_IDENTITY_ENABLED', 'false');

    await expect(handleRequestRegisterAgentApproval({}, ctx)).rejects.toSatisfy((error: unknown) => {
      expectDisabledError(error);
      return true;
    });

    expect(mockResolveMcpSessionByToken).toHaveBeenCalledTimes(1);
    expect(mockGetActiveAgentAccountForOwnerAndAddress).not.toHaveBeenCalled();
    expect(mockCreateApproval).not.toHaveBeenCalled();
  });

  it('preserves existing identity tool behavior when enabled', async () => {
    vi.stubEnv('MCP_AGENT_ACCOUNT_IDENTITY_ENABLED', 'true');
    mockCreateApproval.mockResolvedValue({
      ok: true,
      approval: {
        id: 'approval_1',
        sessionId: session.id,
        ownerAddress: session.ownerAddress,
        agentAccountAddress: session.agentAccountAddress,
        action: 'identity.register',
        chainId: 5042002,
        toAddress: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
        data: '0x1234',
        value: '0x0',
        summary: { type: 'identity_register' },
        policySnapshot: {},
        status: 'awaiting_approval',
        txHash: null,
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-01T00:10:00.000Z',
        approvedAt: null,
        cancelledAt: null,
        submittedAt: null,
        confirmedAt: null,
      },
    });
    mockGetApproval.mockResolvedValue({
      id: 'approval_1',
      sessionId: session.id,
      ownerAddress: session.ownerAddress,
      agentAccountAddress: session.agentAccountAddress,
      action: 'identity.register',
      chainId: 5042002,
      toAddress: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
      data: '0x1234',
      value: '0x0',
      summary: { type: 'identity_register' },
      policySnapshot: {},
      status: 'awaiting_approval',
      txHash: null,
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:10:00.000Z',
      approvedAt: null,
      cancelledAt: null,
      submittedAt: null,
      confirmedAt: null,
    });

    await expect(handleGetAgentAccount({}, ctx)).resolves.toMatchObject({ ok: true });
    await expect(handlePrepareRegisterAgent(metadata, ctx)).resolves.toMatchObject({
      ok: true,
      contract: 'ERC8004_IDENTITY_REGISTRY',
      selector: '0x46d7c549',
    });
    await expect(handleRequestRegisterAgentApproval(metadata, ctx)).resolves.toMatchObject({
      ok: true,
      approvalId: 'approval_1',
      status: 'pending_user_approval',
    });
    await expect(handleGetRegistrationStatus({ approvalId: 'approval_1' }, ctx)).resolves.toMatchObject({
      ok: true,
      approvalId: 'approval_1',
      status: 'awaiting_approval',
    });

    expect(mockGetActiveAgentAccountForOwnerAndAddress).toHaveBeenCalledTimes(3);
    expect(mockCreateApproval).toHaveBeenCalledTimes(1);
    expect(mockGetApproval).toHaveBeenCalledTimes(1);
  });
});
