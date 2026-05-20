/**
 * Official Arc reference contract builders (ERC-8004 + ERC-8183).
 *
 * These helpers target Circle's deployed reference contracts on Arc Testnet.
 * Since ArcLayer now operates in 100% Arc/Circle reference mode, these ARE
 * the primary contract interfaces — not a secondary track.
 *
 * Source of truth: https://docs.arc.io — ERC-8004 / ERC-8183 quickstarts.
 */
export {
  CONTRACTS,
  ARC_REFERENCE_CONTRACTS,
  ARC_TOKENS,
  ARC_CCTP_DOMAIN,
} from "./addresses";

export {
  ERC8004_IDENTITY_REGISTRY_ABI,
  ERC8183_AGENTIC_COMMERCE_ABI,
} from "./abi";

export {
  erc8004IdentityRegistry,
  erc8183AgenticCommerce,
} from "./chain";

import { CONTRACTS } from "./addresses";
import { ERC8004_IDENTITY_REGISTRY_ABI, ERC8183_AGENTIC_COMMERCE_ABI } from "./abi";

// ── ERC-8004 builders ──────────────────────────────────────────────────────────

export function buildErc8004RegisterConfig(metadataURI: string) {
  return {
    address: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
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
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
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
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
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
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
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
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
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
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "complete" as const,
    args: [jobId, reasonHash, optParams] as const,
  };
}

/** Build USDC approve config for ERC-8183 escrow funding. */
export function buildUsdcApproveForJobConfig(amount: bigint) {
  return {
    address: CONTRACTS.USDC,
    abi: [
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
    ] as const,
    functionName: "approve" as const,
    args: [CONTRACTS.ERC8183_AGENTIC_COMMERCE, amount] as const,
  };
}
