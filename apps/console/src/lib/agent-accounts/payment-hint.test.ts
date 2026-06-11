import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getActiveAgentAccountForOwner, isAgentAccountRuntimePayerEnabled } = vi.hoisted(() => ({
  getActiveAgentAccountForOwner: vi.fn(),
  isAgentAccountRuntimePayerEnabled: vi.fn(),
}));

vi.mock('@/lib/agent-accounts/store', () => ({
  getActiveAgentAccountForOwner,
}));

vi.mock('@/lib/agent-accounts/feature-flags', () => ({
  isAgentAccountRuntimePayerEnabled,
}));

import { getAgentWalletPaymentHint } from './payment-hint';

describe('getAgentWalletPaymentHint', () => {
  beforeEach(() => {
    getActiveAgentAccountForOwner.mockReset();
    isAgentAccountRuntimePayerEnabled.mockReset();
  });

  it('returns the legacy EOA fallback when the runtime rail is disabled', async () => {
    isAgentAccountRuntimePayerEnabled.mockReturnValue(false);

    await expect(getAgentWalletPaymentHint('0xowner')).resolves.toEqual({
      payerRail: 'legacy-eoa',
      payerAddress: null,
      legacyEoaFallback: true,
    });
    expect(getActiveAgentAccountForOwner).not.toHaveBeenCalled();
  });

  it('returns the legacy EOA fallback when the owner has no active Agent Wallet', async () => {
    isAgentAccountRuntimePayerEnabled.mockReturnValue(true);
    getActiveAgentAccountForOwner.mockResolvedValue(null);

    await expect(getAgentWalletPaymentHint('0xowner')).resolves.toEqual({
      payerRail: 'legacy-eoa',
      payerAddress: null,
      legacyEoaFallback: true,
    });
  });

  it('returns the active Circle Agent Wallet as the payer hint', async () => {
    isAgentAccountRuntimePayerEnabled.mockReturnValue(true);
    getActiveAgentAccountForOwner.mockResolvedValue({
      agentAccountAddress: '0xagentwallet',
    });

    await expect(getAgentWalletPaymentHint('0xowner')).resolves.toEqual({
      payerRail: 'circle-agent-wallet',
      payerAddress: '0xagentwallet',
      legacyEoaFallback: false,
    });
  });
});
