import { keccak256, toBytes } from "viem";
import { ERC8004_IDENTITY_REGISTRY_ABI, ERC8183_AGENTIC_COMMERCE_ABI, USDC_ABI } from "./abi";
import { CONTRACTS, ZERO_ADDRESS } from "./addresses";

export function hashProtocolString(value: string) {
  return keccak256(toBytes(value.trim()));
}

/**
 * Official ERC-8004 agent registration.
 * Arc/Circle reference signature: register(string metadataURI) → uint256 tokenId.
 */
export function buildRegisterAgentConfig(metadataURI: string): {
  address: typeof CONTRACTS.ERC8004_IDENTITY_REGISTRY;
  abi: typeof ERC8004_IDENTITY_REGISTRY_ABI;
  functionName: "register";
  args: readonly [string];
};

/**
 * @deprecated Legacy compatibility overload. agentId + skill are ignored because
 * ERC-8004 derives tokenId on-chain and only accepts metadataURI.
 */
export function buildRegisterAgentConfig(agentId: bigint, skill: string, metadataURI: string): {
  address: typeof CONTRACTS.ERC8004_IDENTITY_REGISTRY;
  abi: typeof ERC8004_IDENTITY_REGISTRY_ABI;
  functionName: "register";
  args: readonly [string];
};

export function buildRegisterAgentConfig(
  metadataOrAgentId: string | bigint,
  _skill?: string,
  legacyMetadataURI?: string,
) {
  const metadataURI = typeof metadataOrAgentId === "string" ? metadataOrAgentId : legacyMetadataURI;
  if (!metadataURI) throw new Error("metadataURI is required for ERC-8004 register");
  return {
    address: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
    abi: ERC8004_IDENTITY_REGISTRY_ABI,
    functionName: "register" as const,
    args: [metadataURI] as const,
  };
}

/**
 * Official ERC-8183 job creation.
 * Signature: createJob(provider, evaluator, expiredAt, description, hook)
 */
export function buildCreateJobConfig(
  provider: `0x${string}`,
  evaluator: `0x${string}`,
  expiredAt: bigint,
  description: string,
  hook: `0x${string}` = ZERO_ADDRESS,
) {
  return {
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "createJob" as const,
    args: [provider, evaluator, expiredAt, description, hook] as const,
  };
}

export function buildSetBudgetConfig(jobId: bigint, amount: bigint, optParams: `0x${string}` = "0x") {
  return {
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "setBudget" as const,
    args: [jobId, amount, optParams] as const,
  };
}

export function buildApproveUsdcConfig(amount: bigint) {
  return {
    address: CONTRACTS.USDC,
    abi: USDC_ABI,
    functionName: "approve" as const,
    args: [CONTRACTS.ERC8183_AGENTIC_COMMERCE, amount] as const,
  };
}

export function buildFundJobConfig(jobId: bigint, _amount?: bigint, optParams: `0x${string}` = "0x") {
  return {
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "fund" as const,
    args: [jobId, optParams] as const,
  };
}

export function buildSubmitDeliverableConfig(
  jobId: bigint,
  deliverable: `0x${string}` | string,
  _proofMetadataURI?: string,
  optParams: `0x${string}` = "0x",
) {
  const deliverableHash = deliverable.startsWith("0x") && deliverable.length === 66
    ? (deliverable as `0x${string}`)
    : hashProtocolString(deliverable);

  return {
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "submit" as const,
    args: [jobId, deliverableHash, optParams] as const,
  };
}

/** Official ERC-8183 completion. Reason is bytes32; strings are hashed. */
export function buildCompleteJobConfig(jobId: bigint, reason: `0x${string}` | string = "approved", optParams: `0x${string}` = "0x") {
  const reasonHash = reason.startsWith("0x") && reason.length === 66
    ? (reason as `0x${string}`)
    : hashProtocolString(reason);

  return {
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: "complete" as const,
    args: [jobId, reasonHash, optParams] as const,
  };
}

/** @deprecated ERC-8183 uses complete(jobId, reason, optParams), not evaluate(bool). */
export function buildEvaluateJobConfig(jobId: bigint, approved: boolean) {
  return buildCompleteJobConfig(jobId, approved ? "approved" : "rejected");
}

/** @deprecated ERC-8183 uses complete(jobId, reason, optParams), not settle(). */
export function buildSettleJobConfig(jobId: bigint) {
  return buildCompleteJobConfig(jobId, "settled");
}

/** @deprecated No refundRejected() in official ERC-8183 reference flow. */
export function buildRefundRejectedJobConfig(jobId: bigint) {
  return buildCompleteJobConfig(jobId, "rejected");
}

/** @deprecated No cancelJob() in official ERC-8183 reference flow. */
export function buildCancelJobConfig(jobId: bigint) {
  return buildCompleteJobConfig(jobId, "cancelled");
}
