import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
let handleMcpPost: typeof import('./server').handleMcpPost;
beforeAll(async () => { ({ handleMcpPost } = await import('./server')); });
const context = { origin: 'https://arclayers.xyz', method: 'POST', authorization: null };
describe('MCP OAuth enforcement', () => {
  it('keeps public reads available without a token', async () => {
    const response = await handleMcpPost({ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'protocol.status', arguments:{} } }, context);
    expect(response.status).toBe(200);
  });
  it('rejects protected tools without OAuth or legacy bearer auth', async () => {
    const response = await handleMcpPost({ jsonrpc:'2.0', id:1, method:'tools/call', params:{ name:'onboarding.start_agent_bundle', arguments:{} } }, context);
    expect(response.status).toBe(401); expect(JSON.stringify(response.json)).toContain('[UNAUTHORIZED]');
  });
});
