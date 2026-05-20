// Vault contract addresses — Arc Testnet
export const ARC_VAULT_ADDRESS = '0x21ddF0d74B231144960026B9f1A9203a966ec0B5' as const;
export const BOND_CONFIG_ADDRESS = '0x3BFf61a88a45bF44f119B359b4EDeD386Ce4Ee76' as const;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function isZeroAddress(address: string) {
  return address.toLowerCase() === ZERO_ADDRESS;
}

// Re-export from x402 constants for convenience
export { USDC_ADDRESS, ARC_TESTNET_CHAIN_ID } from '@/lib/x402/constants';

/**
 * USDC decimals for ERC-20 token operations (transfer, approve, escrow, x402).
 *
 * NOTE: Arc has TWO USDC interfaces:
 * - ERC-20 contract (this constant, 6 decimals) — used by JobEscrow, x402, vault
 * - Native gas interface (18 decimals) — used by msg.value, getBalance, gas
 *
 * Mirrored in @arclayer/sdk as ARC_ERC20_USDC_DECIMALS.
 */
export const USDC_DECIMALS = 6;

// Job status enum matching contract
export const JOB_STATUS_LABELS = ['None', 'OpenPool', 'Active', 'Completed', 'Cancelled', 'Disputed', 'Resolved'] as const;
export const MILESTONE_STATUS_LABELS = ['Created', 'Submitted', 'Approved', 'Rejected', 'Released', 'Forfeited', 'Disputed'] as const;
