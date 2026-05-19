export type Job = {
  id: string;
  agentId: string;
  client: string;
  worker: string;
  budget: string;
  fundedAmount: string;
  createdAt: string;
  deliverableURI: string;
  proofMetadataURI: string;
  approved: boolean;
  status: number;
};

export type Proof = {
  tokenId: string;
  jobId: string;
  agentId: string;
  payer: string;
  amountPaid: string;
  mintedAt: string;
  metadataURI: string;
};

export type Overview = {
  summary: {
    jobs: number;
    agents: number;
    proofs: number;
    totalBudget: string;
    totalFunded: string;
    settledJobs: number;
    fundedJobs: number;
  };
  jobs: Job[];
  proofs: Proof[];
};

export type FeedItem = {
  id: string;
  ts: string;
  agent: 'Pythia' | 'Ignia' | 'Apolo' | 'Hermes';
  type: 'signal' | 'payment' | 'decision' | 'trade' | 'balance' | 'error';
  label: string;
  detail: string;
  tx?: string;
};

export type AutonomousFeed = {
  items: FeedItem[];
  latest: string | null;
};

export type AgentCategory = 'all' | 'signal-oracles' | 'traders' | 'evaluators' | 'developers' | 'data-providers' | 'payment-agents';

export type RegisteredAgentMetadata = {
  name?: string;
  role?: string;
  description?: string;
  capability?: string[];
  categories?: AgentCategory[];
  autonomous?: boolean;
  endpoint?: string;
  mode?: 'seller' | 'buyer' | 'dual';
  price?: string;
  avatar?: string;
};

export type RegisteredAgent = {
  agentId: string;
  skillHash: string;
  metadataURI: string;
  controller: string;
  registeredAtBlock?: string;
  metadata: RegisteredAgentMetadata | null;
};

export type NetworkAgent = {
  id: string;
  name: string;
  role: string;
  capability: string[];
  description: string;
  status: 'LIVE' | 'RUNNING' | 'IDLE';
  wallet?: string;
  agentId?: string;
  avatar?: string;
  reputation: number;
  callsServed: number;
  jobsCompleted: number;
  revenueRaw: string;
  balanceRaw?: string | null;
  primaryAction: string;
  categories: AgentCategory[];
  activity: FeedItem[];
  source: 'featured' | 'registry';
  canHide: boolean;
  connectedTo?: string[];
};

export type AgentStats = {
  callsServed: number;
  callsFailed: number;
  signalsCorrect: number;
  signalsWrong: number;
  cumulativePnlBps: number;
  calibrationScore: number;
  totalRevenue: string;
  reputationScore: number;
};

export type A2AOnChain = {
  chainId: number;
  contracts: Record<string, string>;
  agents: Record<string, { agentId: string; role: string; stats: AgentStats | null }>;
  wallets: { pythia: string; hermes: string };
  balances: { usdc: { hermes: string | null; pythia: string | null } };
  markets: { totalIgnia: number | null; totalMirrors: number | null };
  timestamp: string;
};
