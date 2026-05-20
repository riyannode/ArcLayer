import type { ReactNode } from 'react';

export type AgentCategory = {
  key: string;
  label: string;
  tagline: string;
  icon: ReactNode;
  capabilities: string[];
  exampleAgents: string[];
  feeRange: string;
  status: 'LIVE' | 'COMING SOON';
};

export const AGENT_CATEGORIES: AgentCategory[] = [
  {
    key: 'prediction-market',
    label: 'Prediction Market',
    tagline: 'Signal generation for binary outcome markets',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12l4-4 4 4 4-8 6 12" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    capabilities: ['Polymarket / Kalshi signal feeds', '5m crypto Up/Down resolution', 'Order book imbalance scoring', 'Probability calibration via backtest'],
    exampleAgents: ['Pythia · BTC 5m signal oracle', 'Apolo · risk + edge gate'],
    feeRange: '0.000001 USDC / call',
    status: 'LIVE',
  },
  {
    key: 'spot-futures',
    label: 'Spot & Futures',
    tagline: 'DEX/CEX execution and perp trading agents',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 17l6-6 4 4 8-8M14 7h7v7" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    capabilities: ['Spot routing via 1inch / Odos / 0x', 'Perp execution on Hyperliquid / GMX', 'Slippage + funding-aware sizing', 'Smart-order routing across venues'],
    exampleAgents: ['Hermes · autonomous trader', 'Echo · perp router (Coming soon)'],
    feeRange: '0.000001 USDC / order',
    status: 'LIVE',
  },
  {
    key: 'arbitrage',
    label: 'Arbitrage',
    tagline: 'Cross-DEX, cross-chain, and MEV opportunities',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 7h10l-3-3M17 17H7l3 3" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    capabilities: ['Cross-DEX price gap monitor', 'Bridge-aware cross-chain routing', 'Mempool / backrun detection', 'Atomic / flash-loan ready'],
    exampleAgents: ['Hermes-arb · cross-DEX scout (Coming soon)'],
    feeRange: '0.000001 USDC / opportunity',
    status: 'COMING SOON',
  },
  {
    key: 'portfolio',
    label: 'Portfolio Manager',
    tagline: 'Allocation, rebalancing, and automated DCA',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l7 4" strokeLinecap="round"/></svg>),
    capabilities: ['Target-weight rebalancing', 'Risk-parity / Kelly sizing', 'Tax-aware harvesting', 'Multi-wallet allocation logic'],
    exampleAgents: ['Custodia · portfolio rebalancer (Coming soon)'],
    feeRange: '0.000001 USDC / cycle',
    status: 'COMING SOON',
  },
  {
    key: 'rwa',
    label: 'RWA',
    tagline: 'Tokenized real-world assets and yield products',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 21V10l9-7 9 7v11M9 21v-6h6v6" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    capabilities: ['T-bill / money-market routing', 'Real-estate token discovery', 'Compliance-gated allocation', 'Yield-curve aware ladders'],
    exampleAgents: ['Castle · RWA allocator (Coming soon)'],
    feeRange: '0.000001 USDC / allocation',
    status: 'COMING SOON',
  },
  {
    key: 'treasury',
    label: 'Treasury & Yield',
    tagline: 'DAO treasury, LP optimization, yield farming',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M8 14h2M14 14h2" strokeLinecap="round"/></svg>),
    capabilities: ['LP impermanent-loss tracker', 'Yield aggregator routing', 'DAO runway forecasting', 'Multi-vault rebalancer'],
    exampleAgents: ['Vault · yield optimizer (Coming soon)'],
    feeRange: '0.000001 USDC / cycle',
    status: 'COMING SOON',
  },
  {
    key: 'social',
    label: 'Social Intelligence',
    tagline: 'X/Twitter sentiment, whale flows, narrative momentum',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    capabilities: ['X timeline + KOL monitoring', 'Smart-money wallet tracker', 'Narrative momentum scoring', 'Discord / Telegram alpha mining'],
    exampleAgents: ['Echo · KOL sentiment (Coming soon)'],
    feeRange: '0.000001 USDC / query',
    status: 'COMING SOON',
  },
  {
    key: 'oracle',
    label: 'Data & Oracle',
    tagline: 'Price feeds, off-chain data, custom oracles',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M2 12h4M18 12h4M12 2v4M12 18v4" strokeLinecap="round"/></svg>),
    capabilities: ['Chainlink + RTDS feeds', 'Custom HTTP oracle bridge', 'Sub-100ms WS price stream', 'Aggregated medianizer'],
    exampleAgents: ['Pythia · price + signal oracle'],
    feeRange: '0.000001 USDC / fetch',
    status: 'LIVE',
  },
  {
    key: 'risk',
    label: 'Risk & Compliance',
    tagline: 'KYC, AML, sanctions screening, tx scoring',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4z" strokeLinecap="round" strokeLinejoin="round"/></svg>),
    capabilities: ['Wallet risk scoring', 'OFAC / sanctions screening', 'Tx pattern flagging', 'Compliance gating for agents'],
    exampleAgents: ['Sentinel · risk gate (Coming soon)'],
    feeRange: '0.000001 USDC / check',
    status: 'COMING SOON',
  },
  {
    key: 'a2a-commerce',
    label: 'A2A Commerce',
    tagline: 'Inter-agent payments, service marketplace, x402',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 4h6l3 5-6 12L3 9l3-5z" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 4l3 5 3-5M3 9h18" strokeLinecap="round"/></svg>),
    capabilities: ['x402 facilitator + verifier', 'Service discovery via manifest', 'Reputation-weighted routing', 'Receipt + WorkProof minting'],
    exampleAgents: ['Apolo · decision broker', 'Hermes · executor'],
    feeRange: '0.000001 USDC / call',
    status: 'LIVE',
  },
  {
    key: 'research',
    label: 'Research Intelligence',
    tagline: 'Due diligence, whitepaper analysis, deep research',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5" strokeLinecap="round"/></svg>),
    capabilities: ['Whitepaper / docs summarization', 'On-chain protocol diagnostics', 'Tokenomics + unlock analysis', 'Comparable-set ranking'],
    exampleAgents: ['Scribe · research analyst (Coming soon)'],
    feeRange: '0.000001 USDC / report',
    status: 'COMING SOON',
  },
  {
    key: 'devops-security',
    label: 'DevOps & Security',
    tagline: 'Audit, monitoring, incident response',
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16 12l-4 4-4-4M12 16V4" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 20h16" strokeLinecap="round"/></svg>),
    capabilities: ['Smart-contract static audit', 'Mempool / RPC monitoring', 'Incident pager + paging', 'CI/CD payload signing'],
    exampleAgents: ['Forge · contract auditor (Coming soon)'],
    feeRange: '0.000001 USDC / job',
    status: 'COMING SOON',
  },
];
