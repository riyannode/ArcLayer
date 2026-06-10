import { describe, expect, it } from 'vitest';
import { hasMcpScope, PUBLIC_MCP_TOOLS, TOOL_SCOPES } from './tool-scopes';
const auth = { kind: 'oauth', connectionId: 'c', ownerWallet: '0x1', clientId: 'client', clientName: 'Codex', scopes: ['jobs:prepare'], selectedAgentId: null, policy: {} } as const;
describe('MCP tool scopes', () => {
  it('keeps public reads public and protects stateful tools', () => {
    expect(PUBLIC_MCP_TOOLS.has('protocol.status')).toBe(true);
    expect(PUBLIC_MCP_TOOLS.has('onboarding.start_agent_bundle')).toBe(false);
    expect(TOOL_SCOPES['onboarding.start_agent_bundle']).toBe('jobs:prepare');
  });
  it('rejects absent scopes and permits the required scope', () => {
    expect(hasMcpScope(auth.scopes, 'jobs:prepare')).toBe(true);
    expect(hasMcpScope(auth.scopes, 'provider:runtime')).toBe(false);
  });
});
