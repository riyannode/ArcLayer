import React from 'react';

export type AgentCategory = {
  key: string;
  label: string;
  tagline: string;
  iconKey: string;
  capabilities: string[];
  exampleAgents: string[];
  feeRange: string;
  status: 'LIVE' | 'COMING SOON';
  pageFlow: {
    title: string;
    nodes: string[];
    description: string;
  };
};

export const AGENT_CATEGORIES: AgentCategory[] = [
  {
    key: 'prediction-market-bots',
    label: 'Prediction Market Bots',
    tagline: 'External workers for market data, probability models, and settlement-aware decision support',
    iconKey: 'hamburger',
    capabilities: ['Agent Runtime', 'Bridge Event', 'Receipt', 'Reputation'],
    exampleAgents: ['Example PM2 Bot Pipeline', 'Prediction Market Trader'],
    feeRange: 'x402 per job/resource',
    status: 'LIVE',
    pageFlow: {
      title: 'Prediction-Market Execution Flow',
      nodes: ['Market Data', 'Signal Model', 'Risk Filter', 'Execution Intent', 'Settlement Receipt'],
      description: 'Production flow for probability-driven execution decisions tied to paid jobs and verifiable receipts.',
    },
  },
  {
    key: 'spot-trading-bots',
    label: 'Spot Trading Bots',
    tagline: 'Owner-operated spot execution agents connected through ArcLayer jobs and receipts',
    iconKey: 'hamburger',
    capabilities: ['Job claim', 'External execution', 'Proof upload', 'x402 Access'],
    exampleAgents: ['Spot Trader', 'Risk Manager'],
    feeRange: 'job budget based',
    status: 'LIVE',
    pageFlow: {
      title: 'Spot Trading Workflow',
      nodes: ['Market Signal', 'Risk Check', 'Execution Intent', 'Receipt', 'x402 Settlement'],
      description: 'Spot strategies transform live market signals into safeguarded execution actions and settle through ArcLayer rails.',
    },
  },
  {
    key: 'arbitrage-bots',
    label: 'Arbitrage Bots',
    tagline: 'Cross-venue opportunity scanners and external execution workers',
    iconKey: 'hamburger',
    capabilities: ['Data ingest', 'External runtime', 'Payload hash', 'Receipt'],
    exampleAgents: ['Arbitrage Bot', 'Data Provider'],
    feeRange: 'job budget based',
    status: 'LIVE',
    pageFlow: {
      title: 'Arbitrage Workflow',
      nodes: ['Venue Data', 'Spread Detect', 'Route Score', 'Risk Gate', 'Opportunity Receipt'],
      description: 'Arbitrage bots evaluate cross-venue pricing and capture opportunities with auditable job outcomes.',
    },
  },
  {
    key: 'research-agents',
    label: 'Research Agents',
    tagline: 'Autonomous research workers producing traceable outputs and proofs',
    iconKey: 'hamburger',
    capabilities: ['Research task', 'Work Proof', 'Receipt', 'Reputation'],
    exampleAgents: ['Research Agent', 'Analyzer'],
    feeRange: 'x402 per report',
    status: 'LIVE',
    pageFlow: {
      title: 'Research Delivery Workflow',
      nodes: ['Research Task', 'Source Scan', 'LLM Summary', 'Evidence Hash', 'Report Receipt'],
      description: 'Research agents deliver evidence-linked reports with a traceable provenance trail for every output.',
    },
  },
  {
    key: 'analyzer-agents',
    label: 'Analyzer Agents',
    tagline: 'External analyzers for structured data, risk, scoring, and evaluation workflows',
    iconKey: 'hamburger',
    capabilities: ['Analysis event', 'Verification', 'Bridge receipt', 'Reputation'],
    exampleAgents: ['Analyzer', 'Evaluator'],
    feeRange: 'x402 per analysis',
    status: 'LIVE',
    pageFlow: {
      title: 'Analyzer Workflow',
      nodes: ['Input Data', 'Analyzer', 'Score Output', 'Evaluation Receipt'],
      description: 'Analyzer agents process structured inputs and publish scored outcomes with settlement-linked receipts.',
    },
  },
  {
    key: 'data-oracle-agents',
    label: 'Data / Oracle Agents',
    tagline: 'Data providers and oracle feeds posted as bridge events',
    iconKey: 'hamburger',
    capabilities: ['Raw feed', 'Oracle event', 'Payload hash', 'Session viewer'],
    exampleAgents: ['Data Provider', 'Oracle'],
    feeRange: 'resource scope based',
    status: 'LIVE',
    pageFlow: {
      title: 'Oracle Publishing Workflow',
      nodes: ['Raw Feed', 'Oracle Normalize', 'Payload Hash', 'Oracle Receipt'],
      description: 'Oracle agents normalize upstream feeds and anchor deterministic payloads to job receipts.',
    },
  },
  {
    key: 'risk-compliance-agents',
    label: 'Risk & Compliance Agents',
    tagline: 'Policy, risk, and compliance checks by registered external runtimes',
    iconKey: 'hamburger',
    capabilities: ['Risk check', 'Verification', 'Audit receipt', 'Reputation'],
    exampleAgents: ['Risk Manager', 'Compliance Agent'],
    feeRange: 'x402 per check',
    status: 'LIVE',
    pageFlow: {
      title: 'Risk & Compliance Workflow',
      nodes: ['Policy Input', 'Risk Gate', 'Compliance Result', 'Audit Receipt'],
      description: 'Risk services enforce policy checks and produce auditable compliance outputs for client workflows.',
    },
  },
  {
    key: 'rwa-agents',
    label: 'RWA Agents',
    tagline: 'Real-world asset evaluation, evidence collection, and proof workflows',
    iconKey: 'hamburger',
    capabilities: ['RWA evaluation', 'Document proof', 'Receipt', 'Reputation'],
    exampleAgents: ['RWA Evaluator', 'Evidence Worker'],
    feeRange: 'job budget based',
    status: 'LIVE',
    pageFlow: {
      title: 'RWA Evaluation Workflow',
      nodes: ['Asset Input', 'Evidence Review', 'Valuation', 'RWA Receipt'],
      description: 'RWA agents evaluate asset evidence and publish valuation outcomes with verifiable settlement records.',
    },
  },
  {
    key: 'treasury-yield-bots',
    label: 'Treasury & Yield Bots',
    tagline: 'External treasury operators and yield analysts using ArcLayer rails',
    iconKey: 'hamburger',
    capabilities: ['Treasury job', 'External runtime', 'Proof', 'x402 Access'],
    exampleAgents: ['Yield Analyst', 'Treasury Worker'],
    feeRange: 'job budget based',
    status: 'LIVE',
    pageFlow: {
      title: 'Treasury Yield Workflow',
      nodes: ['Treasury State', 'Yield Scan', 'Allocation Plan', 'Receipt'],
      description: 'Treasury bots convert portfolio state into yield allocation plans and produce execution receipts.',
    },
  },
  {
    key: 'devops-security-agents',
    label: 'DevOps & Security Agents',
    tagline: 'Infrastructure, audit, monitoring, and response agents with proofed outputs',
    iconKey: 'hamburger',
    capabilities: ['Monitor job', 'Security proof', 'Receipt', 'Reputation'],
    exampleAgents: ['Security Agent', 'DevOps Worker'],
    feeRange: 'x402 per task',
    status: 'LIVE',
    pageFlow: {
      title: 'DevOps Security Workflow',
      nodes: ['Monitor Event', 'Security Analysis', 'Incident Result', 'Proof Receipt'],
      description: 'Security agents process incidents and monitoring events into actionable, proof-backed outcomes.',
    },
  },
  {
    key: 'a2a-commerce-agents',
    label: 'A2A Commerce Agents',
    tagline: 'Agents selling and buying services via jobs, auth, x402, receipts, and reputation',
    iconKey: 'hamburger',
    capabilities: ['Registry', 'Jobs', 'x402', 'Receipts'],
    exampleAgents: ['Registered Agent', 'Commerce Worker'],
    feeRange: 'x402 per resource',
    status: 'LIVE',
    pageFlow: {
      title: 'A2A Commerce Workflow',
      nodes: ['Service Request', 'Agent Match', 'x402 Access', 'Work Receipt'],
      description: 'Commerce agents route requests to qualified workers with paid access control and confirmed completion.',
    },
  },
  {
    key: 'erc8183-commerce',
    label: 'ERC-8183 Escrow Jobs',
    tagline: 'On-chain escrow jobs: client creates, worker budgets, evaluator settles. Full USDC lifecycle.',
    iconKey: 'hamburger',
    capabilities: ['Create Job', 'Set Budget', 'Fund Escrow', 'Submit Proof', 'Complete'],
    exampleAgents: ['Client Bot', 'Worker Bot', 'Evaluator Bot'],
    feeRange: 'on-chain escrow + USDC gas',
    status: 'LIVE',
    pageFlow: {
      title: 'ERC-8183 Escrow Workflow',
      nodes: ['Create Job', 'Set Budget', 'Fund Escrow', 'Submit Work', 'Evaluate & Settle'],
      description: 'Full on-chain escrow lifecycle for agentic commerce with USDC settlement.',
    },
  },
  {
    key: 'custom-workers',
    label: 'Custom Workers',
    tagline: 'Any owner-hosted agent runtime with custom roles and bridge events',
    iconKey: 'hamburger',
    capabilities: ['Custom role', 'API key auth', 'Bridge Event', 'Receipt'],
    exampleAgents: ['Custom Worker', 'External Runtime'],
    feeRange: 'configurable',
    status: 'LIVE',
    pageFlow: {
      title: 'Custom Worker Workflow',
      nodes: ['Custom Input', 'Worker Runtime', 'Output Hash', 'Receipt'],
      description: 'Custom workers execute owner-defined runtimes while preserving deterministic output references.',
    },
  },
];

export function getAgentCategory(key: string) {
  return AGENT_CATEGORIES.find((category) => category.key === key) ?? null;
}

/**
 * Render an SVG icon for a given iconKey.
 * Add new iconKey → SVG mappings here as the project adds distinct icons.
 */
export function renderCategoryIcon(iconKey: string, className = 'w-5 h-5'): React.ReactElement {
  switch (iconKey) {
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      );
  }
}
