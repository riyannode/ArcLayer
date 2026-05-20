export const USDC_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const MILESTONE_ESCROW_ABI = [
  {
    name: "createProject",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "client", type: "address" },
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "milestoneTitles", type: "string[]" },
      { name: "milestoneAmounts", type: "uint256[]" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "fundProject",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "submitMilestone",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneId", type: "uint256" },
      { name: "deliverableURI", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "approveMilestone",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "milestoneId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "cancelProject",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "projectCounter",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "projects",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "freelancer", type: "address" },
      { name: "client", type: "address" },
      { name: "totalAmount", type: "uint256" },
      { name: "releasedAmount", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "milestoneCount", type: "uint256" },
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "status", type: "uint8" }
    ]
  },
  {
    name: "milestones",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint256" }
    ],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "projectId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "submittedAt", type: "uint256" },
      { name: "releasedAt", type: "uint256" },
      { name: "title", type: "string" },
      { name: "deliverableURI", type: "string" },
      { name: "status", type: "uint8" }
    ]
  },
  {
    name: "getUserProjects",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }]
  },
  {
    name: "ProjectCreated",
    type: "event",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "freelancer", type: "address", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false }
    ]
  },
  {
    name: "ProjectFunded",
    type: "event",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false }
    ]
  },
  {
    name: "MilestoneSubmitted",
    type: "event",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "milestoneId", type: "uint256", indexed: true },
      { name: "deliverableURI", type: "string", indexed: false }
    ]
  },
  {
    name: "MilestoneReleased",
    type: "event",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "milestoneId", type: "uint256", indexed: true },
      { name: "freelancer", type: "address", indexed: true },
      { name: "payout", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false }
    ]
  },
  {
    name: "WorkProofMinted",
    type: "event",
    inputs: [
      { name: "projectId", type: "uint256", indexed: true },
      { name: "freelancer", type: "address", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false }
    ]
  }
] as const;

export const AGENT_REGISTRY_ABI = [
  {
    name: "registerAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "skillHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "updateAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "skillHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "getAgent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        components: [
          { name: "agentId", type: "uint256" },
          { name: "skillHash", type: "bytes32" },
          { name: "metadataURI", type: "string" },
          { name: "controller", type: "address" },
          { name: "registeredAt", type: "uint256" },
          { name: "reputationScore", type: "uint256" },
          { name: "exists", type: "bool" },
        ],
        name: "",
        type: "tuple",
      },
    ],
  },
  {
    name: "exists",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "AgentRegistered",
    type: "event",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "skillHash", type: "bytes32", indexed: true },
      { name: "controller", type: "address", indexed: true },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
] as const;

export const JOB_ESCROW_ABI = [
  {
    name: "createJob",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "worker", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "jobSpecHash", type: "bytes32" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    name: "setBudget",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "budget", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "fund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "submitDeliverable",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliverableURI", type: "string" },
      { name: "proofMetadataURI", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "evaluate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "settle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "refundRejected",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "cancelJob",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "jobCounter",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "jobs",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "agentId", type: "uint256" },
      { name: "client", type: "address" },
      { name: "worker", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "budget", type: "uint256" },
      { name: "fundedAmount", type: "uint256" },
      { name: "createdAt", type: "uint256" },
      { name: "jobSpecHash", type: "bytes32" },
      { name: "deliverableURI", type: "string" },
      { name: "proofMetadataURI", type: "string" },
      { name: "approved", type: "bool" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    name: "getUserJobs",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "getJobsByAgentId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "JobCreated",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "worker", type: "address", indexed: false },
      { name: "evaluator", type: "address", indexed: false },
      { name: "jobSpecHash", type: "bytes32", indexed: false },
    ],
  },
  {
    name: "JobFunded",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    name: "DeliverableSubmitted",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "deliverableURI", type: "string", indexed: false },
    ],
  },
  {
    name: "JobSettled",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "worker", type: "address", indexed: true },
      { name: "payout", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
] as const;

export const WORK_PROOF_ABI = [
  {
    name: "proofTokenByJobId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getProofsByAgent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "getProof",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        components: [
          { name: "jobId", type: "uint256" },
          { name: "agentId", type: "uint256" },
          { name: "payer", type: "address" },
          { name: "amountPaid", type: "uint256" },
          { name: "mintedAt", type: "uint256" },
          { name: "metadataURI", type: "string" },
        ],
        name: "",
        type: "tuple",
      },
    ],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "WorkProofMinted",
    type: "event",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "jobId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "payer", type: "address", indexed: false },
      { name: "amountPaid", type: "uint256", indexed: false },
    ],
  },
] as const;

export const REPUTATION_ORACLE_ABI = [
  {
    name: "getScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
