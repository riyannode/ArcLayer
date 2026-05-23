import { keccak256, toBytes } from "viem";
import { ERC8004_IDENTITY_REGISTRY_ABI, ERC8004_REPUTATION_REGISTRY_ABI, ERC8004_VALIDATION_REGISTRY_ABI, ERC8183_AGENTIC_COMMERCE_ABI, USDC_ABI } from "./abi";
import { CONTRACTS, ZERO_ADDRESS } from "./addresses";

export function hashProtocolString(value: string) {
  return keccak256(toBytes(value.trim()));
}

export function buildRegisterAgentConfig(
  metadataURI: string,
) {
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



export function buildGiveFeedbackConfig(
  agentTokenId: bigint,
  score: bigint,
  category: number,
  comment: string,
  metadataURI: string,
  proofURI: string,
  context: string,
  ref: `0x${string}`,
) {
  return {
    address: CONTRACTS.ERC8004_REPUTATION_REGISTRY,
    abi: ERC8004_REPUTATION_REGISTRY_ABI,
    functionName: "giveFeedback" as const,
    args: [agentTokenId, score, category, comment, metadataURI, proofURI, context, ref] as const,
  };
}

export function buildValidationRequestConfig(validator: `0x${string}`, agentTokenId: bigint, taskUri: string, requestHash: `0x${string}`) {
  return {
    address: CONTRACTS.ERC8004_VALIDATION_REGISTRY,
    abi: ERC8004_VALIDATION_REGISTRY_ABI,
    functionName: "validationRequest" as const,
    args: [validator, agentTokenId, taskUri, requestHash] as const,
  };
}

export function buildValidationResponseConfig(
  requestHash: `0x${string}`,
  status: number,
  resultUri: string,
  resultHash: `0x${string}`,
  reason: string,
) {
  return {
    address: CONTRACTS.ERC8004_VALIDATION_REGISTRY,
    abi: ERC8004_VALIDATION_REGISTRY_ABI,
    functionName: "validationResponse" as const,
    args: [requestHash, status, resultUri, resultHash, reason] as const,
  };
}

export function buildGetValidationStatusConfig(requestHash: `0x${string}`) {
  return {
    address: CONTRACTS.ERC8004_VALIDATION_REGISTRY,
    abi: ERC8004_VALIDATION_REGISTRY_ABI,
    functionName: "getValidationStatus" as const,
    args: [requestHash] as const,
  };
}
