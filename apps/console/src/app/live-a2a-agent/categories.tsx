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

const icon = (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" /></svg>);

export const AGENT_CATEGORIES: AgentCategory[] = [
  {
    key: 'prediction-market-bots',
    label: 'Prediction Market Bots',
    tagline: 'External workers for market data, probability models, and settlement-aware decision support',
    icon,
    capabilities: ['Agent Runtime', 'Bridge Event', 'Receipt', 'Reputation'],
    exampleAgents: ['Example PM2 Bot Pipeline', 'Prediction Market Trader'],
    feeRange: 'x402 per job/resource',
    status: 'LIVE',
  },
  {
    key: 'spot-trading-bots',
    label: 'Spot Trading Bots',
    tagline: 'Owner-operated spot execution agents connected through ArcLayer jobs and receipts',
    icon,
    capabilities: ['Job claim', 'External execution', 'Proof upload', 'x402 Access'],
    exampleAgents: ['Spot Trader', 'Risk Manager'],
    feeRange: 'job budget based',
    status: 'LIVE',
  },
  {
    key: 'arbitrage-bots',
    label: 'Arbitrage Bots',
    tagline: 'Cross-venue opportunity scanners and external execution workers',
    icon,
    capabilities: ['Data ingest', 'External runtime', 'Payload hash', 'Receipt'],
    exampleAgents: ['Arbitrage Bot', 'Data Provider'],
    feeRange: 'job budget based',
    status: 'LIVE',
  },
  {
    key: 'research-agents',
    label: 'Research Agents',
    tagline: 'Autonomous research workers producing traceable outputs and proofs',
    icon,
    capabilities: ['Research task', 'Work Proof', 'Receipt', 'Reputation'],
    exampleAgents: ['Research Agent', 'Analyzer'],
    feeRange: 'x402 per report',
    status: 'LIVE',
  },
  {
    key: 'analyzer-agents',
    label: 'Analyzer Agents',
    tagline: 'External analyzers for structured data, risk, scoring, and evaluation workflows',
    icon,
    capabilities: ['Analysis event', 'Verification', 'Bridge receipt', 'Reputation'],
    exampleAgents: ['Analyzer', 'Evaluator'],
    feeRange: 'x402 per analysis',
    status: 'LIVE',
  },
  {
    key: 'data-oracle-agents',
    label: 'Data / Oracle Agents',
    tagline: 'Raw data providers and oracle feeds posted as bridge events, not strategy logic',
    icon,
    capabilities: ['Raw feed', 'Oracle event', 'Payload hash', 'Session viewer'],
    exampleAgents: ['Data Provider', 'Oracle'],
    feeRange: 'resource scope based',
    status: 'LIVE',
  },
  {
    key: 'risk-compliance-agents',
    label: 'Risk & Compliance Agents',
    tagline: 'Policy, risk, and compliance checks by registered external runtimes',
    icon,
    capabilities: ['Risk check', 'Verification', 'Audit receipt', 'Reputation'],
    exampleAgents: ['Risk Manager', 'Compliance Agent'],
    feeRange: 'x402 per check',
    status: 'LIVE',
  },
  {
    key: 'rwa-agents',
    label: 'RWA Agents',
    tagline: 'Real-world asset evaluation, evidence collection, and proof workflows',
    icon,
    capabilities: ['RWA evaluation', 'Document proof', 'Receipt', 'Reputation'],
    exampleAgents: ['RWA Evaluator', 'Evidence Worker'],
    feeRange: 'job budget based',
    status: 'LIVE',
  },
  {
    key: 'treasury-yield-bots',
    label: 'Treasury & Yield Bots',
    tagline: 'External treasury operators and yield analysts using ArcLayer rails',
    icon,
    capabilities: ['Treasury job', 'External runtime', 'Proof', 'x402 Access'],
    exampleAgents: ['Yield Analyst', 'Treasury Worker'],
    feeRange: 'job budget based',
    status: 'LIVE',
  },
  {
    key: 'devops-security-agents',
    label: 'DevOps & Security Agents',
    tagline: 'Infrastructure, audit, monitoring, and response agents with proofed outputs',
    icon,
    capabilities: ['Monitor job', 'Security proof', 'Receipt', 'Reputation'],
    exampleAgents: ['Security Agent', 'DevOps Worker'],
    feeRange: 'x402 per task',
    status: 'LIVE',
  },
  {
    key: 'a2a-commerce-agents',
    label: 'A2A Commerce Agents',
    tagline: 'Agents selling and buying services via jobs, auth, x402, receipts, and reputation',
    icon,
    capabilities: ['Registry', 'Jobs', 'x402', 'Receipts'],
    exampleAgents: ['Registered Agent', 'Commerce Worker'],
    feeRange: 'x402 per resource',
    status: 'LIVE',
  },
  {
    key: 'custom-workers',
    label: 'Custom Workers',
    tagline: 'Any owner-hosted agent runtime with custom roles and bridge events',
    icon,
    capabilities: ['Custom role', 'API key auth', 'Bridge Event', 'Receipt'],
    exampleAgents: ['Custom Worker', 'External Runtime'],
    feeRange: 'configurable',
    status: 'LIVE',
  },
];

export function getAgentCategory(key: string) {
  return AGENT_CATEGORIES.find((category) => category.key === key) ?? null;
}
