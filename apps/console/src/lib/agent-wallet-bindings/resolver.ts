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

import { ARC_CHAIN_ID } from '@arclayer/sdk';
import {
  getActiveAgentWalletBindingByAgentId,
  type AgentWalletBinding,
} from './store';

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
  | 'unsupported_controller_mode';

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

function normalizeAgentId(agentId: string): string {
  return agentId.trim();
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
 * This function does not verify on-chain ownership again.
 * On-chain mint proof verification happens when the binding is created.
 */
export async function resolveAgentIdentityBinding(
  agentId: string,
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

  return toIdentityContext(binding);
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
 * Resolve the payment context for future x402 paid-resource flows.
 *
 * This is read-only. It does not verify Gateway balance, deposit funds,
 * generate x402 payment payloads, or settle payments.
 *
 * Current mode: Circle Gateway only.
 * Arc Native x402 is intentionally not exposed here yet.
 * Current production path is Circle Gateway x402 for nanopayment / batch settlement.
 */
export async function resolveX402PaymentContext(
  agentId: string,
): Promise<ResolveX402PaymentContextResult> {
  const resolved = await resolveAgentIdentityBinding(agentId);

  if (!resolved.ok) {
    return resolved;
  }

  return {
    ok: true,
    binding: resolved.binding,
    data: {
      ...resolved.data,
      rail: 'x402',
      mode: 'circle-gateway',
      payerAddress: resolved.data.agentAccountAddress,
      paymentAuthorityAddress: resolved.data.agentAccountAddress,
      requiresGatewayBalanceCheck: true,
    },
  };
}
