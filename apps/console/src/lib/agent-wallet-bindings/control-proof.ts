/**
 * Agent Wallet Binding Control Proof
 *
 * Helpers for verifying that an Agent Wallet (Circle Smart Account)
 * actually approves the binding to an ERC-8004 identity.
 *
 * Uses EIP-1271 isValidSignature for smart contract wallet verification.
 *
 * This file is intentionally stateless — no DB writes, no chain mutations.
 */

import {
  getAddress,
  hashMessage,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';

const EIP1271_MAGIC_VALUE = '0x1626ba7e';

const EIP1271_ABI = [
  {
    name: 'isValidSignature',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'magicValue', type: 'bytes4' }],
  },
] as const;

export type AgentWalletBindingChallenge = {
  ownerAddress: string;
  agentAccountAddress: string;
  agentId: string;
  registrationTxHash: string | null;
  chainId: number;
  nonce: string;
  expiresAt: string;
};

export function buildAgentWalletBindingMessage(input: AgentWalletBindingChallenge): string {
  return [
    'ArcLayer Agent Wallet Binding',
    '',
    `Owner EOA: ${getAddress(input.ownerAddress)}`,
    `Agent Wallet: ${getAddress(input.agentAccountAddress)}`,
    `ERC-8004 Agent ID: ${input.agentId.trim()}`,
    `Registration Tx: ${input.registrationTxHash || 'none'}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Expires At: ${input.expiresAt}`,
    '',
    'Only sign this message if you want this Agent Wallet to control this ERC-8004 identity on ArcLayer.',
  ].join('\n');
}

export function isFreshBindingChallenge(input: {
  nonce: unknown;
  expiresAt: unknown;
}): input is { nonce: string; expiresAt: string } {
  if (typeof input.nonce !== 'string' || input.nonce.trim().length < 16) return false;
  if (typeof input.expiresAt !== 'string') return false;

  const expires = Date.parse(input.expiresAt);
  if (!Number.isFinite(expires)) return false;

  return expires > Date.now();
}

export async function verifyAgentWalletControlSignature(input: {
  publicClient: PublicClient;
  agentAccountAddress: string;
  message: string;
  signature: string;
}): Promise<{ ok: true } | { ok: false; error: string; detail: string }> {
  if (!isAddress(input.agentAccountAddress)) {
    return {
      ok: false,
      error: 'invalid_agent_wallet_address',
      detail: 'Agent Wallet address is invalid.',
    };
  }

  if (!/^0x[a-fA-F0-9]+$/.test(input.signature)) {
    return {
      ok: false,
      error: 'invalid_agent_wallet_signature',
      detail: 'Agent Wallet signature must be hex encoded.',
    };
  }

  const digest = hashMessage(input.message);
  const wallet = getAddress(input.agentAccountAddress) as Address;

  try {
    const magic = await input.publicClient.readContract({
      address: wallet,
      abi: EIP1271_ABI,
      functionName: 'isValidSignature',
      args: [digest, input.signature as Hex],
    });

    if (String(magic).toLowerCase() !== EIP1271_MAGIC_VALUE) {
      return {
        ok: false,
        error: 'agent_wallet_signature_rejected',
        detail: 'Agent Wallet did not approve the binding challenge.',
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'agent_wallet_signature_verification_failed',
      detail: 'Could not verify Agent Wallet control via EIP-1271.',
    };
  }
}
