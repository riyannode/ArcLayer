import { keccak256, toBytes } from "viem";
import { AGENT_REGISTRY_ABI, JOB_ESCROW_ABI, USDC_ABI } from "./abi";
import { CONTRACTS } from "./addresses";

export function hashProtocolString(value: string) {
  return keccak256(toBytes(value.trim()));
}

export function buildRegisterAgentConfig(agentId: bigint, skill: string, metadataURI: string) {
  return {
    address: CONTRACTS.AGENT_REGISTRY,
    abi: AGENT_REGISTRY_ABI,
    functionName: "registerAgent" as const,
    args: [agentId, hashProtocolString(skill), metadataURI] as const,
  };
}

export function buildCreateJobConfig(
  agentId: bigint,
  worker: `0x${string}`,
  evaluator: `0x${string}`,
  jobSpec: string
) {
  return {
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: "createJob" as const,
    args: [agentId, worker, evaluator, hashProtocolString(jobSpec)] as const,
  };
}

export function buildSetBudgetConfig(jobId: bigint, budget: bigint) {
  return {
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: "setBudget" as const,
    args: [jobId, budget] as const,
  };
}

export function buildApproveUsdcConfig(amount: bigint) {
  return {
    address: CONTRACTS.USDC,
    abi: USDC_ABI,
    functionName: "approve" as const,
    args: [CONTRACTS.JOB_ESCROW, amount] as const,
  };
}

export function buildFundJobConfig(jobId: bigint, amount: bigint) {
  return {
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: "fund" as const,
    args: [jobId, amount] as const,
  };
}

export function buildSubmitDeliverableConfig(jobId: bigint, deliverableURI: string, proofMetadataURI: string) {
  return {
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: "submitDeliverable" as const,
    args: [jobId, deliverableURI, proofMetadataURI] as const,
  };
}

export function buildEvaluateJobConfig(jobId: bigint, approved: boolean) {
  return {
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: "evaluate" as const,
    args: [jobId, approved] as const,
  };
}

export function buildSettleJobConfig(jobId: bigint) {
  return {
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: "settle" as const,
    args: [jobId] as const,
  };
}

export function buildRefundRejectedJobConfig(jobId: bigint) {
  return {
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: "refundRejected" as const,
    args: [jobId] as const,
  };
}

export function buildCancelJobConfig(jobId: bigint) {
  return {
    address: CONTRACTS.JOB_ESCROW,
    abi: JOB_ESCROW_ABI,
    functionName: "cancelJob" as const,
    args: [jobId] as const,
  };
}
