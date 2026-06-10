import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getActiveSessionForWallet: vi.fn(),
  createRequest: vi.fn(),
}));
vi.mock('./signing-bridge/store', () => mocks);
import { handleRequestCreateJobWebSign } from './signing-bridge-tools';
const owner = '0x1111111111111111111111111111111111111111';
const ctx = { request: { origin:'https://arclayers.xyz', method:'POST' }, auth: { kind:'oauth', connectionId:'connection-1', ownerWallet:owner, clientId:'client-1', clientName:'Codex', scopes:['tx:request'], selectedAgentId:null, policy:{} } } as any;
describe('OAuth browser signing bridge', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getActiveSessionForWallet.mockResolvedValue({ id:'signing-session-1', owner_wallet:owner, status:'active' }); mocks.createRequest.mockResolvedValue({ id:'request-1', status:'pending' }); });
  it('creates a wallet-scoped signing request and never broadcasts a transaction', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await handleRequestCreateJobWebSign({ provider:'0x2222222222222222222222222222222222222222', evaluator:owner, expiredAt:String(Math.floor(Date.now()/1000)+3600), description:'OAuth bridge test', hook:'0x0000000000000000000000000000000000000000' }, ctx) as any;
    expect(result).toMatchObject({ requestId:'request-1', status:'pending' });
    expect(mocks.getActiveSessionForWallet).toHaveBeenCalledWith(owner);
    expect(mocks.createRequest).toHaveBeenCalledWith('signing-session-1','create_job',5042002,owner,expect.any(Array),expect.objectContaining({ mcpConnectionId:'connection-1', requestedByOwnerWallet:owner }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
