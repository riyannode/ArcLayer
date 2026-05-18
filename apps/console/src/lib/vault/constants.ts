// Vault contract addresses — update after deploy
// ArcVault is NOT yet deployed. These are placeholders.
// After `forge create` on Arc Testnet, update these values.

export const ARC_VAULT_ADDRESS = '0x0000000000000000000000000000000000000000' as const; // TODO: deploy
export const BOND_CONFIG_ADDRESS = '0x0000000000000000000000000000000000000000' as const; // TODO: deploy

// Re-export from x402 constants for convenience
export { USDC_ADDRESS, ARC_TESTNET_CHAIN_ID } from '@/lib/x402/constants';

export const USDC_DECIMALS = 6;

// Job status enum matching contract
export const JOB_STATUS_LABELS = ['None', 'OpenPool', 'Active', 'Completed', 'Cancelled', 'Disputed', 'Resolved'] as const;
export const MILESTONE_STATUS_LABELS = ['Created', 'Submitted', 'Approved', 'Rejected', 'Released', 'Forfeited', 'Disputed'] as const;
