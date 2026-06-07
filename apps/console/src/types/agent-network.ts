export type Job = {
  id: string;
  client: string;
  provider: string;
  evaluator: string;
  budget: string;
  fundedAmount: string;
  createdAt: string;
  description: string;
  deliverable: string;
  completionReason: string;
  status: number;
};


export type Proof = Record<string, unknown>;

export type Overview = {
  summary: {
    jobs: number;
    agents: number;
    proofs: number;
    budgetedUsdc?: string;
    fundedUsdc?: string;
    totalBudgetAtomic?: string;
    totalFundedAtomic?: string;
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
  agent: string;
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

export type RegisteredAgentSource =
  | 'erc8004_identity_registry'
  | 'web_manifest'
  | 'external-registry'
  | 'indexer'
  | 'registry'
  | string;

export type AgentReputationDetail = {
  source?: string;
  score?: number;
  tier?: string;
  totalJobs?: number;
  completedJobs?: number;
  submittedJobs?: number;
  activeJobs?: number;
  rejectedJobs?: number;
  failedJobs?: number;
  expiredJobs?: number;
  totalVolumeAtomic?: string;
  totalVolumeUsdc?: number;
  completedLast7d?: number;
  updatedAt?: string;
};

export type RegisteredAgent = {
  /**
   * Canonical ArcLayer agent ID.
   * For ERC-8004 agents this must equal tokenId.
   * Kept as agentId for compatibility with existing UI/routes.
   */
  agentId: string;

  /**
   * ERC-8004 Identity Registry tokenId.
   * For web_manifest / external-registry agents this may be undefined.
   */
  tokenId?: string | null;

  owner?: string;
  controller: string;
  endpoint?: string;
  metadataURI: string;
  registeredAtBlock?: string | null;
  source?: RegisteredAgentSource;
  onchain?: boolean;
  skillHash?: string;
  reputationScore?: string;
  score?: string;
  reputation?: AgentReputationDetail;
  jobs?: string[];
  proofTokenIds?: string[];
  metadata: RegisteredAgentMetadata | null;
};

export type NetworkAgent = {
  id: string;
  tokenId?: string | null;
  name: string;
  role: string;
  capability: string[];
  description: string;
  status: 'LIVE' | 'RUNNING' | 'IDLE';
  wallet?: string;
  owner?: string;
  controller?: string;
  agentId?: string;
  metadataURI?: string;
  source: RegisteredAgentSource;
  avatar?: string;
  reputation: number;
  reputationDetail?: AgentReputationDetail;
  callsServed: number;
  jobsCompleted: number;
  revenueRaw: string;
  balanceRaw?: string | null;
  primaryAction: string;
  categories: AgentCategory[];
  activity: FeedItem[];
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
  agents?: Record<string, { agentId: string; role: string; stats: AgentStats | null }>;
  balances?: { usdc?: Record<string, string | null> };
  markets: { totalMirrors: number | null };
  timestamp: string;
};
