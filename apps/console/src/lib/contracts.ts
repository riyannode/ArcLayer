import { ARC_EXPLORER } from '@arcwork/sdk';

export { ARC_CHAIN_ID, ARC_EXPLORER, CONTRACTS, USDC_ABI, MILESTONE_ESCROW_ABI } from '@arcwork/sdk';

export const BADGE_NAMES = [
  'First Transaction',
  'Bridge USDC',
  'Deploy Contract',
  'Refer Friends',
  'Complete Invoice',
] as const;

export const BADGE_EMOJIS = ['⚡', '🌉', '📦', '👥', '✅'] as const;

export const INVOICE_STATUS = ['Pending', 'Paid', 'Completed', 'Cancelled'] as const;
export const PROJECT_STATUS = ['Created', 'Funded', 'Completed', 'Cancelled'] as const;
export const MILESTONE_STATUS = ['Created', 'Funded', 'Submitted', 'Released'] as const;

export function formatUSDC(amount: bigint): string {
  return (Number(amount) / 1e6).toFixed(2);
}

export function parseUSDC(amount: string): bigint {
  return BigInt(Math.floor(parseFloat(amount) * 1e6));
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getExplorerTxUrl(hash: string): string {
  return `${ARC_EXPLORER}/tx/${hash}`;
}

export function getExplorerAddressUrl(address: string): string {
  return `${ARC_EXPLORER}/address/${address}`;
}
