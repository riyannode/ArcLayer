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
