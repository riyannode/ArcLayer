// Contract addresses (deploy and update these)
export const CONTRACTS = {
  USDC: '0x3600000000000000000000000000000000000000',
  ACHIEVEMENT: '0x52138F4C77e53805CaaeD0D2e39292EC312C8440',
  INVOICE: '0x1Eb2Ed241Cb978f4BF02DA68E128D50AD7A53Fbf',
  SUBSCRIPTION: '0x01028Ca35bE5c3dcE85F661C6528138bc3Ad9Fc1',
  MILESTONE_ESCROW: '0x0000000000000000000000000000000000000000',
} as const;

export const ARC_CHAIN_ID = 5042002;
export const ARC_EXPLORER = 'https://testnet.arcscan.app';

// Minimal ABIs for frontend interaction
export const USDC_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const MILESTONE_ESCROW_ABI = [
  {
    name: 'createProject',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'client', type: 'address' },
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'milestoneTitles', type: 'string[]' },
      { name: 'milestoneAmounts', type: 'uint256[]' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'fundProject',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'submitMilestone',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'milestoneId', type: 'uint256' },
      { name: 'deliverableURI', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'approveMilestone',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'milestoneId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'cancelProject',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'projectCounter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'projects',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'freelancer', type: 'address' },
      { name: 'client', type: 'address' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'releasedAmount', type: 'uint256' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'milestoneCount', type: 'uint256' },
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    name: 'milestones',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'uint256' },
    ],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'projectId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'submittedAt', type: 'uint256' },
      { name: 'releasedAt', type: 'uint256' },
      { name: 'title', type: 'string' },
      { name: 'deliverableURI', type: 'string' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    name: 'getUserProjects',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'ProjectCreated',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true },
      { name: 'freelancer', type: 'address', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'totalAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'ProjectFunded',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'totalAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'MilestoneSubmitted',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true },
      { name: 'milestoneId', type: 'uint256', indexed: true },
      { name: 'deliverableURI', type: 'string', indexed: false },
    ],
  },
  {
    name: 'MilestoneReleased',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true },
      { name: 'milestoneId', type: 'uint256', indexed: true },
      { name: 'freelancer', type: 'address', indexed: true },
      { name: 'payout', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'WorkProofMinted',
    type: 'event',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true },
      { name: 'freelancer', type: 'address', indexed: true },
      { name: 'totalAmount', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const ACHIEVEMENT_ABI = [
  {
    name: 'mintBadge',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'badgeType', type: 'uint8' },
      { name: 'metadataURI', type: 'string' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'hasBadge',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'uint8' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getUserBadges',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'getBadge',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      {
        components: [
          { name: 'badgeType', type: 'uint8' },
          { name: 'mintedAt', type: 'uint256' },
          { name: 'metadataURI', type: 'string' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
  },
  {
    name: 'BadgeMinted',
    type: 'event',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'badgeType', type: 'uint8', indexed: false },
      { name: 'tokenId', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const INVOICE_ABI = [
  {
    name: 'createInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'client', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'description', type: 'string' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'payInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'completeInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'cancelInvoice',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'invoices',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'creator', type: 'address' },
      { name: 'client', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'description', type: 'string' },
      { name: 'status', type: 'uint8' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'paidAt', type: 'uint256' },
    ],
  },
  {
    name: 'invoiceCounter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'InvoiceCreated',
    type: 'event',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'InvoicePaid',
    type: 'event',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const SUBSCRIPTION_ABI = [
  {
    name: 'createPlan',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'interval', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'subscribe',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'planId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'cancelSubscription',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'subId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'plans',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'creator', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interval', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    name: 'subscriptions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' },
      { name: 'planId', type: 'uint256' },
      { name: 'subscriber', type: 'address' },
      { name: 'startTime', type: 'uint256' },
      { name: 'lastCharged', type: 'uint256' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    name: 'planCounter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'subscriptionCounter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getUserSubscriptions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'isReadyToCharge',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'subId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

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
