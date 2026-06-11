/**
 * Internal Agent Payment Resolver
 *
 * Converts a verified ERC-8004 Agent Wallet binding into reusable
 * server-side contexts for ERC-8183 and x402.
 *
 * This file is intentionally read-only:
 * - no x402 settlement
 * - no Gateway deposit
 * - no ERC-8183 job creation
 * - no Runner execution
 * - no DB writes
 *
 * Current x402 mode: Circle Gateway only.
 * Arc Native x402 is intentionally not exposed here yet.
 */

import { getAddress } from 'viem';
import { ARC_CHAIN_ID } from '@arclayer/sdk';
import {
  getActiveAgentWalletBindingByAgentId,
  type AgentWalletBinding,
} from './store';
import { getActiveAgentAccountForOwnerAndAddress } from '@/lib/agent-accounts/store';
import { getERC8004OwnerOf } from '@/lib/contracts/erc8004';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

export type AgentPaymentRail = 'erc8183' | 'x402';
export type X402PaymentMode = 'circle-gateway';

export type AgentIdentityBindingContext = {
  agentId: string;
  ownerAddress: `0x${string}`;
  agentAccountAddress: `0x${string}`;
  controllerAddress: `0x${string}`;
  controllerMode: 'agent-account';
  chainId: typeof ARC_CHAIN_ID;
  registrationTxHash: `0x${string}` | null;
  metadataUri: string | null;
  bindingStatus: 'active';
};

export type ERC8183SettlementContext = AgentIdentityBindingContext & {
  rail: 'erc8183';
  settlementActor: `0x${string}`;
  settlementIdentity: `0x${string}`;
};

export type X402PaymentContext = AgentIdentityBindingContext & {
  rail: 'x402';
  mode: 'circle-gateway';
  payerAddress: `0x${string}`;
  paymentAuthorityAddress: `0x${string}`;
  requiresGatewayBalanceCheck: true;
};

export type AgentResolverError =
  | 'agent_id_required'
  | 'agent_wallet_binding_not_found'
  | 'unsupported_chain_id'
  | 'unsupported_controller_mode'
  | 'agent_wallet_binding_stale'
  | 'agent_account_inactive'
  | 'agent_x402_payer_not_configured';

export type ResolveAgentIdentityBindingResult =
  | {
      ok: true;
      data: AgentIdentityBindingContext;
      binding: AgentWalletBinding;
    }
  | {
      ok: false;
      error: AgentResolverError;
      detail: string;
    };

export type ResolveERC8183SettlementContextResult =
  | {
      ok: true;
      data: ERC8183SettlementContext;
      binding: AgentWalletBinding;
    }
  | {
      ok: false;
      error: AgentResolverError;
      detail: string;
    };

export type ResolveX402PaymentContextResult =
  | {
      ok: true;
      data: X402PaymentContext;
      binding: AgentWalletBinding;
    }
  | {
      ok: false;
      error: AgentResolverError;
      detail: string;
    };

function normalizeAgentId(agentId: unknown): string {
  return typeof agentId === 'string' ? agentId.trim() : '';
}

function toIdentityContext(binding: AgentWalletBinding): ResolveAgentIdentityBindingResult {
  if (binding.chainId !== ARC_CHAIN_ID) {
    return {
      ok: false,
      error: 'unsupported_chain_id',
      detail: `Only Arc Testnet chainId ${ARC_CHAIN_ID} is supported.`,
    };
  }

  if (binding.controllerMode !== 'agent-account') {
    return {
      ok: false,
      error: 'unsupported_controller_mode',
      detail: 'Only Agent Wallet controller bindings are supported.',
    };
  }

  // Agent Account = controller in ERC-8004 agent-account mode
  return {
    ok: true,
    binding,
    data: {
      agentId: binding.agentId,
      ownerAddress: binding.ownerAddress,
      agentAccountAddress: binding.agentAccountAddress,
      controllerAddress: binding.agentAccountAddress,
      controllerMode: 'agent-account',
      chainId: ARC_CHAIN_ID,
      registrationTxHash: binding.registrationTxHash,
      metadataUri: binding.metadataUri,
      bindingStatus: 'active',
    },
  };
}

/**
 * Resolve the verified ERC-8004 Agent Wallet binding for an agent.
 *
 * Source of truth:
 * arclayer_agent_wallet_bindings
 *
 * Validation steps:
 * 1. Find active binding from DB
 * 2. Validate chain and controller mode
 * 3. Confirm Agent Account is still active in arclayer_agent_accounts
 * 4. Revalidate ERC-8004 on-chain ownership matches binding
 *
 * Deactivation of stale bindings is not done here (read-only).
 */
export async function resolveAgentIdentityBinding(
  agentId: unknown,
): Promise<ResolveAgentIdentityBindingResult> {
  const normalizedAgentId = normalizeAgentId(agentId);

  if (!normalizedAgentId) {
    return {
      ok: false,
      error: 'agent_id_required',
      detail: 'agentId is required.',
    };
  }

  const binding = await getActiveAgentWalletBindingByAgentId(normalizedAgentId);

  if (!binding) {
    return {
      ok: false,
      error: 'agent_wallet_binding_not_found',
      detail: 'No active Agent Wallet binding exists for this ERC-8004 Agent ID.',
    };
  }

  const context = toIdentityContext(binding);
  if (!context.ok) return context;

  // P2: Confirm Agent Account is still active.
  // upsertAgentAccountForOwner disables old accounts on replacement,
  // but the binding table is not automatically deactivated.
  const activeAgentAccount = await getActiveAgentAccountForOwnerAndAddress(
    binding.ownerAddress,
    binding.agentAccountAddress,
  );

  if (!activeAgentAccount) {
    return {
      ok: false,
      error: 'agent_account_inactive',
      detail: 'Agent Wallet binding points to a disabled or inactive Agent Account.',
    };
  }

  // P1: Revalidate ERC-8004 on-chain ownership.
  // If the token was transferred after binding was created, the DB row is stale.
  try {
    const currentOwner = await getERC8004OwnerOf(binding.agentId);
    if (getAddress(currentOwner).toLowerCase() !== binding.agentAccountAddress.toLowerCase()) {
      return {
        ok: false,
        error: 'agent_wallet_binding_stale',
        detail: 'ERC-8004 ownership changed after this binding was created.',
      };
    }
  } catch {
    // ownerOf reverts for non-existent tokens — treat as stale
    return {
      ok: false,
      error: 'agent_wallet_binding_stale',
      detail: 'ERC-8004 token not found or ownership check failed.',
    };
  }

  return context;
}

/**
 * Resolve the settlement context for future ERC-8183 job/escrow flows.
 *
 * This is read-only. It does not create jobs, escrow, or settlement txs.
 */
export async function resolveERC8183SettlementContext(
  agentId: string,
): Promise<ResolveERC8183SettlementContextResult> {
  const resolved = await resolveAgentIdentityBinding(agentId);

  if (!resolved.ok) {
    return resolved;
  }

  return {
    ok: true,
    binding: resolved.binding,
    data: {
      ...resolved.data,
      rail: 'erc8183',
      settlementActor: resolved.data.agentAccountAddress,
      settlementIdentity: resolved.data.agentAccountAddress,
    },
  };
}

/**
 * Resolve the payment context for x402 paid-resource flows.
 *
 * This is read-only. It does not verify Gateway balance, deposit funds,
 * generate x402 payment payloads, or settle payments.
 *
 * Current mode: Circle Gateway only.
 * Arc Native x402 is intentionally not exposed here yet.
 * Current production path is Circle Gateway x402 for nanopayment / batch settlement.
 *
 * Payer resolution:
 * Looks up active agent_x402_payers row for (agentId, rail=circle-gateway, scope=a2a).
 * If no active payer is registered, returns agent_x402_payer_not_configured.
 */
export async function resolveX402PaymentContext(
  agentId: string,
): Promise<ResolveX402PaymentContextResult> {
  const resolved = await resolveAgentIdentityBinding(agentId);

  if (!resolved.ok) {
    return resolved;
  }

  // Look up the registered x402 payer for this agent.
  // The binding's agentAccountAddress is the Agent Wallet, but the actual
  // x402 payer must be explicitly registered in agent_x402_payers.
  const supabase = getSupabaseAdmin();
  const { data: payerRow, error: payerError } = await supabase
    .from('agent_x402_payers')
    .select('payer_address')
    .eq('agent_id', resolved.data.agentId)
    .eq('rail', 'circle-gateway')
    .eq('scope', 'a2a')
    .eq('status', 'active')
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle();

  if (payerError || !payerRow) {
    return {
      ok: false,
      error: 'agent_x402_payer_not_configured',
      detail: 'No active x402 payer binding exists for this agent. Register a payer before resolving x402 context.',
    };
  }

  const payerAddress = getAddress(payerRow.payer_address) as `0x${string}`;

  return {
    ok: true,
    binding: resolved.binding,
    data: {
      ...resolved.data,
      rail: 'x402',
      mode: 'circle-gateway',
      payerAddress,
      paymentAuthorityAddress: payerAddress,
      requiresGatewayBalanceCheck: true,
    },
  };
}
