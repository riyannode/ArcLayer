/**
 * Official Arc reference contract builders (ERC-8004 + ERC-8183).
 *
 * These helpers target Circle's deployed reference contracts on Arc Testnet,
 * NOT ArcLayer's own protocol contracts (AGENT_REGISTRY / JOB_ESCROW).
 *
 * Use when integrating directly with the official Arc agentic-economy spec.
 * Use ArcLayer builders in writes.ts for ArcLayer-specific flows.
 *
 * Source of truth: https://docs.arc.io — ERC-8004 / ERC-8183 quickstarts.
 */
import { ARC_REFERENCE_CONTRACTS } from "./addresses";

// ── Minimal ABI fragments for the official reference contracts ─────────────────

export const ERC8004_IDENTITY_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "metadataURI", type: "string" }],
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
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    name: "JobSubmitted",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "deliverable", type: "bytes32", indexed: false },
    ],
  },
  {
    name: "JobCompleted",
    type: "event",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "reason", type: "bytes32", indexed: false },
    ],
  },
] as const;

// ── ERC-8004 builders ──────────────────────────────────────────────────────────

export function buildErc8004RegisterConfig(metadataURI: string) {
  return {
    address: ARC_REFERENCE_CONTRACTS.ERC8004_IDENTITY_REGISTRY,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: "register" as const,
    args: [metadataURI] as const,
  };
}

// ── ERC-8183 builders ──────────────────────────────────────────────────────────

export function buildErc8183CreateJobConfig(
  provider: `0x${string}`,
  evaluator: `0x${string}`,
  expiredAt: bigint,
  description: string,
  hook: `0x${string}` = "0x0000000000000000000000000000000000000000",
) {
  return {
    address: ARC_REFERENCE_CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "createJob" as const,
    args: [provider, evaluator, expiredAt, description, hook] as const,
  };
}

export function buildErc8183SetBudgetConfig(
  jobId: bigint,
  amount: bigint,
  optParams: `0x${string}` = "0x",
) {
  return {
    address: ARC_REFERENCE_CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "setBudget" as const,
    args: [jobId, amount, optParams] as const,
  };
}

export function buildErc8183FundConfig(
  jobId: bigint,
  optParams: `0x${string}` = "0x",
) {
  return {
    address: ARC_REFERENCE_CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "fund" as const,
    args: [jobId, optParams] as const,
  };
}

export function buildErc8183SubmitConfig(
  jobId: bigint,
  deliverableHash: `0x${string}`,
  optParams: `0x${string}` = "0x",
) {
  return {
    address: ARC_REFERENCE_CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "submit" as const,
    args: [jobId, deliverableHash, optParams] as const,
  };
}

export function buildErc8183CompleteConfig(
  jobId: bigint,
  reasonHash: `0x${string}`,
  optParams: `0x${string}` = "0x",
) {
  return {
    address: ARC_REFERENCE_CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "complete" as const,
    args: [jobId, reasonHash, optParams] as const,
  };
}
