import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  resolveSessionFromCookie: vi.fn(),
  getLinkedErc8004AgentsForController: vi.fn(),
  getActiveAgentAccountForOwner: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/auth/wallet-session', () => ({
  SESSION_COOKIE_NAME: 'wallet-session',
  resolveSessionFromCookie: mocks.resolveSessionFromCookie,
  getLinkedErc8004AgentsForController: mocks.getLinkedErc8004AgentsForController,
}));

vi.mock('@/lib/agent-accounts/store', () => ({
  getActiveAgentAccountForOwner: mocks.getActiveAgentAccountForOwner,
}));

vi.mock('@/lib/agent-accounts/feature-flags', () => ({
  isAgentAccountServerRailEnabled: () => true,
}));

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

import { POST } from './route';

const OWNER = '0x1111111111111111111111111111111111111111';
const AGENT_WALLET = '0x2222222222222222222222222222222222222222';

function makeRequest(scope = 'a2a') {
  return new NextRequest('http://localhost/api/agents/agent-1/x402-payer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'wallet-session=test-session',
    },
    body: JSON.stringify({
      payerAddress: AGENT_WALLET,
      rail: 'circle-gateway',
      scope,
    }),
  });
}

describe('POST /api/agents/[id]/x402-payer Agent Wallet guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSessionFromCookie.mockResolvedValue({ wallet: OWNER });
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
      { tokenId: '1', agentId: 'agent-1' },
    ]);
    mocks.getActiveAgentAccountForOwner.mockResolvedValue({
      agentAccountAddress: AGENT_WALLET,
    });
  });

  it('rejects owner-linked Agent Wallet insertion for A2A scope before Supabase writes', async () => {
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'agent-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('agent_wallet_payer_binding_disabled');
    expect(body.detail).toContain('owner-level runtime payer hints');
    expect(mocks.getActiveAgentAccountForOwner).toHaveBeenCalledWith(OWNER);
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });
});
