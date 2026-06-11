import { getActiveAgentAccountForOwner } from '@/lib/agent-accounts/store';
import { isAgentAccountRuntimePayerEnabled } from '@/lib/agent-accounts/feature-flags';

export type AgentWalletPaymentHint = {
  payerRail: 'circle-agent-wallet' | 'legacy-eoa';
  payerAddress: string | null;
  legacyEoaFallback: boolean;
};

export async function getAgentWalletPaymentHint(
  ownerAddress?: string | null,
): Promise<AgentWalletPaymentHint> {
  if (!ownerAddress || !isAgentAccountRuntimePayerEnabled()) {
    return {
      payerRail: 'legacy-eoa',
      payerAddress: null,
      legacyEoaFallback: true,
    };
  }

  const agentAccount = await getActiveAgentAccountForOwner(ownerAddress);

  if (!agentAccount?.agentAccountAddress) {
    return {
      payerRail: 'legacy-eoa',
      payerAddress: null,
      legacyEoaFallback: true,
    };
  }

  return {
    payerRail: 'circle-agent-wallet',
    payerAddress: agentAccount.agentAccountAddress,
    legacyEoaFallback: false,
  };
}
