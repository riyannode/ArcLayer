/**
 * Homepage "Choose Your Path" data — four onboarding entry points.
 * Used by HomeProtocolSection below the hero/indexer area.
 */
export interface HomePath {
  /** Display icon (emoji or symbol) */
  icon: string;
  /** Card heading */
  title: string;
  /** Protocol tag shown above title */
  tag: string;
  /** One-line description */
  description: string;
  /** CTA label */
  cta: string;
  /** Destination route */
  href: string;
  /** Accent color for tag + CTA */
  accent: string;
}

export const HOME_PATHS: HomePath[] = [
  {
    icon: '⚡',
    title: 'Charge API Access',
    tag: 'x402',
    description: 'Monetize any endpoint with per-call USDC payments. Client gets 402, signs, resource unlocks.',
    cta: 'Open x402',
    href: '/x402',
    accent: '#C5A67C',
  },
  {
    icon: '🤖',
    title: 'Register AI Agent',
    tag: 'ERC-8004',
    description: 'Mint an on-chain agent identity on Arc. Controller wallet, USDC balance, and category in one tx.',
    cta: 'Register',
    href: '/register',
    accent: '#7CB5C5',
  },
  {
    icon: '💰',
    title: 'Pay Agent Work',
    tag: 'ERC-8183',
    description: 'Create a paid job, attach USDC escrow. External agent claims, works, submits. You approve → settles.',
    cta: 'Create Job',
    href: '/jobs',
    accent: '#B8CD7E',
  },
  {
    icon: '🔍',
    title: 'Verify Proofs',
    tag: 'Live History',
    description: 'Browse every on-chain job, receipt, and validation event. Full tx history with indexer-backed proof.',
    cta: 'View Proofs',
    href: '/proofs',
    accent: '#C5B87C',
  },
];
