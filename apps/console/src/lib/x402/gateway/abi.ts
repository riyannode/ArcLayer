/**
 * GatewayWallet — minimal ABI for client-side deposit flow.
 *
 * Only includes the read/write functions we touch from the browser.
 * The full ABI lives server-side in @circle-fin/x402-batching.
 *
 * Source: Circle Gateway docs + on-chain inspection of
 *   0x0077777d7EBA4688BDeF3E311b846F25870A19B9 (Arc Testnet)
 */
export const GATEWAY_WALLET_ABI = [
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'deposit',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'deposits',
    inputs: [
      { name: 'depositor', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** Minimal ERC-20 ABI for approve/allowance/balanceOf. */
export const ERC20_ABI = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
