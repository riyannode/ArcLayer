/**
 * Official Arc Network ABIs — ERC-8004 + ERC-8183.
 *
 * These are the canonical ABIs for Circle's deployed reference contracts
 * on Arc Testnet. All agent identity and job flows use these.
 *
 * Source: https://docs.arc.io/arc/references/contract-addresses.md
 */

// ── USDC ERC-20 (minimal) ────────────────────────────────────────────────────

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

// ── ERC-8004 Identity Registry ───────────────────────────────────────────────

export const ERC8004_IDENTITY_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "metadataURI", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
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
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "Transfer",
    type: "event",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;


// ── ERC-8004 Reputation Registry ─────────────────────────────────────────────

export const ERC8004_REPUTATION_REGISTRY_ABI = [
  {
    name: "giveFeedback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentTokenId", type: "uint256" },
      { name: "score", type: "int128" },
      { name: "category", type: "uint8" },
      { name: "comment", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "proofURI", type: "string" },
      { name: "context", type: "string" },
      { name: "ref", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "NewFeedback",
    type: "event",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "clientAddress", type: "address", indexed: true },
      { name: "feedbackIndex", type: "uint64", indexed: false },
      { name: "value", type: "int128", indexed: false },
      { name: "valueDecimals", type: "uint8", indexed: false },
      { name: "indexedTag1", type: "string", indexed: true },
      { name: "tag1", type: "string", indexed: false },
      { name: "tag2", type: "string", indexed: false },
      { name: "endpoint", type: "string", indexed: false },
      { name: "feedbackURI", type: "string", indexed: false },
      { name: "feedbackHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

// ── ERC-8004 Validation Registry ─────────────────────────────────────────────

export const ERC8004_VALIDATION_REGISTRY_ABI = [
  {
    name: "validationRequest",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "validator", type: "address" },
      { name: "agentTokenId", type: "uint256" },
      { name: "taskUri", type: "string" },
      { name: "requestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "validationResponse",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestHash", type: "bytes32" },
      { name: "status", type: "uint8" },
      { name: "resultUri", type: "string" },
      { name: "resultHash", type: "bytes32" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "getValidationStatus",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "response", type: "uint8" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "string" },
      { name: "lastUpdate", type: "uint256" },
    ],
  },
] as const;

// ── ERC-8183 Agentic Commerce ────────────────────────────────────────────────

export const ERC8183_AGENTIC_COMMERCE_ABI = [
  {
    name: "createJob",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "description", type: "string" },
      { name: "hook", type: "address" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    name: "setBudget",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "fund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "submit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliverable", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "complete",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reason", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "getJob",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" },
        ],
      },
    ],
  },
  {
    name: "reject",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "reason", type: "bytes32" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "claimRefund",
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
    name: "jobHasBudget",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{ name: "hasBudget", type: "bool" }],
  },
  {
    name: "paymentToken",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "setProvider",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "provider_", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "JobCreated",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "client", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "evaluator", type: "address", indexed: false },
      { name: "expiredAt", type: "uint256", indexed: false },
      { name: "hook", type: "address", indexed: false },
    ],
  },
  {
    name: "BudgetSet",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
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
    name: "JobSubmitted",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "worker", type: "address", indexed: true },
      { name: "deliverable", type: "bytes32", indexed: false },
    ],
  },
  {
    name: "JobCompleted",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "evaluator", type: "address", indexed: true },
      { name: "reason", type: "bytes32", indexed: false },
    ],
  },
  {
    name: "JobRejected",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "rejector", type: "address", indexed: true },
      { name: "reason", type: "bytes32", indexed: false },
    ],
  },
  {
    name: "JobExpired",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
    ],
  },
  {
    name: "ProviderSet",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "provider", type: "address", indexed: true },
    ],
  },
] as const;

