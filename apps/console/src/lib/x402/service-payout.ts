import { getAddress } from 'viem';
import { getSupabaseAdmin } from './supabaseClient';

export type ResolveX402ServicePayoutInput = {
  serviceAgentId?: string | null;
  serviceOwnerAgentId?: string | null;
  resourceOwnerAgentId?: string | null;
  toolOwnerAgentId?: string | null;
  /** Use only for endpoints where agentId is clearly the service owner. */
  agentId?: string | null;
};

function cleanAgentId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function servicePayoutError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function resolveServiceOwnerAgentId(ctx: ResolveX402ServicePayoutInput): string {
  const serviceOwnerAgentId =
    cleanAgentId(ctx.serviceAgentId) ||
    cleanAgentId(ctx.serviceOwnerAgentId) ||
    cleanAgentId(ctx.resourceOwnerAgentId) ||
    cleanAgentId(ctx.toolOwnerAgentId) ||
    cleanAgentId(ctx.agentId);

  if (!serviceOwnerAgentId) {
    throw servicePayoutError('service_agent_missing', 'service_agent_missing');
  }

  return serviceOwnerAgentId;
}

/**
 * Resolve the role-agnostic payout EOA for an agent-owned service/resource/tool.
 *
 * This returns the x402 `payTo` address. It never falls back to a platform
 * receiver and never treats the GatewayWallet contract as payer or receiver.
 */
export async function resolveX402ServicePayoutAddress(
  ctx: ResolveX402ServicePayoutInput,
): Promise<`0x${string}`> {
  const serviceOwnerAgentId = resolveServiceOwnerAgentId(ctx);

  const { data, error } = await getSupabaseAdmin()
    .from('a2a_agent_commerce_profiles')
    .select('agent_id, pay_to, is_active')
    .eq('agent_id', serviceOwnerAgentId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw servicePayoutError('service_payout_address_missing', 'service_payout_address_missing');
  }

  const payoutAddress = typeof data?.pay_to === 'string' ? data.pay_to.trim() : '';
  if (!payoutAddress) {
    throw servicePayoutError('service_payout_address_missing', 'service_payout_address_missing');
  }

  try {
    return getAddress(payoutAddress) as `0x${string}`;
  } catch {
    throw servicePayoutError('service_payout_address_invalid', 'service_payout_address_invalid');
  }
}
