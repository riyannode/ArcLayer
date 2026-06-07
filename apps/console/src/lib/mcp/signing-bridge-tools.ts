/**
 * MCP Signing Bridge Tools — Wrapper tools for web-session signing.
 *
 * These tools:
 * 1. Call existing prepare handlers to get tx instructions
 * 2. Validate the returned tx against whitelist
 * 3. Create a signing request for the configured sessionId
 * 4. Return requestId + status polling instruction
 *
 * No private keys. No tx execution. Just prepare + create request.
 */

import { encodeFunctionData, type Hex, type Address } from 'viem';
import {
  ERC8183_AGENTIC_COMMERCE_ABI,
  USDC_ABI,
  CONTRACTS,
  ARC_TOKENS,
} from '@arclayer/sdk';
import type { McpToolContext } from './registry';
import { MCP_ERRORS, McpError } from './errors';
import type { SigningTransaction, SigningRequestSummary } from './signing-bridge/whitelist';

// ── Constants ─────────────────────────────────────────────────────────────

const ARC_CHAIN_ID = 5042002;
const ARC_BASE_URL = process.env.ARCLAYER_BASE_URL || 'https://arclayers.xyz';
const SIGNING_SESSION_ID = process.env.ARCLAYER_SIGNING_SESSION_ID || '';

// ── Helpers ───────────────────────────────────────────────────────────────

function requireSigningSession(): string {
  if (!SIGNING_SESSION_ID) {
    throw new McpError(
      MCP_ERRORS.VALIDATION_ERROR,
      'ARCLAYER_SIGNING_SESSION_ID not configured. Start a signing session in ArcLayer Profile first.',
    );
  }
  return SIGNING_SESSION_ID;
}

async function createSigningRequest(
  actionType: string,
  transactions: SigningTransaction[],
  summary?: SigningRequestSummary,
  expectedClientWallet?: string,
): Promise<{ requestId: string; status: string }> {
  const sessionId = requireSigningSession();

  const res = await fetch(`${ARC_BASE_URL}/api/mcp/signing-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      actionType,
      chainId: ARC_CHAIN_ID,
      expectedClientWallet: expectedClientWallet || process.env.ARCLAYER_CLIENT_WALLET || '',
      transactions,
      summary,
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new McpError(
      MCP_ERRORS.INTERNAL_ERROR,
      `Failed to create signing request: ${data.error}${data.detail ? ` — ${data.detail}` : ''}`,
    );
  }

  return { requestId: data.request.id, status: data.request.status };
}

async function pollRequestStatus(requestId: string): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${ARC_BASE_URL}/api/mcp/signing-requests/${requestId}`,
  );
  const data = await res.json();
  if (!data.ok) {
    throw new McpError(MCP_ERRORS.INTERNAL_ERROR, `Failed to read request: ${data.error}`);
  }
  return data.request;
}

// ── Tool: request_create_job_web_sign ─────────────────────────────────────

export async function handleRequestCreateJobWebSign(
  args: Record<string, unknown>,
  _ctx: McpToolContext,
): Promise<unknown> {
  const provider = String(args.provider || '').trim();
  const evaluator = String(args.evaluator || '').trim();
  const expiredAt = String(args.expiredAt || '').trim();
  const description = String(args.description || '').trim();
  const hook = String(args.hook || '0x').trim();

  if (!provider) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'provider required');
  if (!evaluator) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'evaluator required');
  if (!expiredAt) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'expiredAt required');

  // Encode createJob calldata
  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: 'createJob',
    args: [
      provider as Address,
      evaluator as Address,
      BigInt(expiredAt),
      description,
      hook as Hex,
    ],
  });

  const transactions: SigningTransaction[] = [
    {
      kind: 'erc8183_create_job',
      to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      data,
      value: '0',
      summary: `Create job: provider=${provider.slice(0, 10)}… evaluator=${evaluator.slice(0, 10)}…`,
    },
  ];

  const result = await createSigningRequest(
    'create_job',
    transactions,
    {
      actionType: 'create_job',
      providerAddress: provider,
      evaluatorAddress: evaluator,
      description,
      deadline: new Date(Number(expiredAt) * 1000).toISOString(),
    },
  );

  return {
    ok: true,
    message: 'Signing request sent to your open ArcLayer Profile signing session.',
    requestId: result.requestId,
    status: result.status,
    pollInstructions: `Use client.get_signing_request_status with requestId="${result.requestId}" to check outcome.`,
  };
}

// ── Tool: request_fund_job_web_sign ───────────────────────────────────────

export async function handleRequestFundJobWebSign(
  args: Record<string, unknown>,
  _ctx: McpToolContext,
): Promise<unknown> {
  const jobId = String(args.jobId || '').trim();
  const amount = String(args.amount || '').trim();

  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  if (!amount) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'amount required (USDC atomic units)');

  const amountBigInt = BigInt(amount);
  const commerceAddr = CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address;

  // Fund bundle: USDC approve + fund(jobId)
  const approveData = encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'approve',
    args: [commerceAddr, amountBigInt],
  });

  const fundData = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: 'fund',
    args: [BigInt(jobId), '0x' as Hex],
  });

  const transactions: SigningTransaction[] = [
    {
      kind: 'usdc_approve',
      to: ARC_TOKENS.USDC,
      data: approveData,
      value: '0',
      summary: `Approve ${amount} USDC for job #${jobId}`,
    },
    {
      kind: 'erc8183_fund',
      to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      data: fundData,
      value: '0',
      summary: `Fund job #${jobId}`,
    },
  ];

  const result = await createSigningRequest(
    'fund_job',
    transactions,
    { actionType: 'fund_job', jobId, amountUsdc: amount },
  );

  return {
    ok: true,
    message: 'Signing request sent to your open ArcLayer Profile signing session.',
    requestId: result.requestId,
    status: result.status,
    pollInstructions: `Use client.get_signing_request_status with requestId="${result.requestId}" to check outcome.`,
  };
}

// ── Tool: request_complete_job_web_sign ───────────────────────────────────

export async function handleRequestCompleteJobWebSign(
  args: Record<string, unknown>,
  _ctx: McpToolContext,
): Promise<unknown> {
  const jobId = String(args.jobId || '').trim();
  const reasonHash = String(args.reasonHash || '0x0000000000000000000000000000000000000000000000000000000000000000').trim();

  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: 'complete',
    args: [BigInt(jobId), reasonHash as Hex, '0x' as Hex],
  });

  const transactions: SigningTransaction[] = [
    {
      kind: 'erc8183_complete',
      to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      data,
      value: '0',
      summary: `Complete job #${jobId}`,
    },
  ];

  const result = await createSigningRequest(
    'complete_job',
    transactions,
    { actionType: 'complete_job', jobId },
  );

  return {
    ok: true,
    message: 'Signing request sent to your open ArcLayer Profile signing session.',
    requestId: result.requestId,
    status: result.status,
    pollInstructions: `Use client.get_signing_request_status with requestId="${result.requestId}" to check outcome.`,
  };
}

// ── Tool: request_reject_job_web_sign ─────────────────────────────────────

export async function handleRequestRejectJobWebSign(
  args: Record<string, unknown>,
  _ctx: McpToolContext,
): Promise<unknown> {
  const jobId = String(args.jobId || '').trim();
  const reasonHash = String(args.reasonHash || '0x0000000000000000000000000000000000000000000000000000000000000000').trim();

  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: 'reject',
    args: [BigInt(jobId), reasonHash as Hex, '0x' as Hex],
  });

  const transactions: SigningTransaction[] = [
    {
      kind: 'erc8183_reject',
      to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      data,
      value: '0',
      summary: `Reject job #${jobId}`,
    },
  ];

  const result = await createSigningRequest(
    'reject_job',
    transactions,
    { actionType: 'reject_job', jobId },
  );

  return {
    ok: true,
    message: 'Signing request sent to your open ArcLayer Profile signing session.',
    requestId: result.requestId,
    status: result.status,
    pollInstructions: `Use client.get_signing_request_status with requestId="${result.requestId}" to check outcome.`,
  };
}

// ── Tool: request_claim_refund_web_sign ───────────────────────────────────

export async function handleRequestClaimRefundWebSign(
  args: Record<string, unknown>,
  _ctx: McpToolContext,
): Promise<unknown> {
  const jobId = String(args.jobId || '').trim();

  if (!jobId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: 'claimRefund',
    args: [BigInt(jobId)],
  });

  const transactions: SigningTransaction[] = [
    {
      kind: 'erc8183_claim_refund',
      to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      data,
      value: '0',
      summary: `Claim refund for job #${jobId}`,
    },
  ];

  const result = await createSigningRequest(
    'claim_refund',
    transactions,
    { actionType: 'claim_refund', jobId },
  );

  return {
    ok: true,
    message: 'Signing request sent to your open ArcLayer Profile signing session.',
    requestId: result.requestId,
    status: result.status,
    pollInstructions: `Use client.get_signing_request_status with requestId="${result.requestId}" to check outcome.`,
  };
}

// ── Tool: get_signing_request_status ──────────────────────────────────────

export async function handleGetSigningRequestStatus(
  args: Record<string, unknown>,
  _ctx: McpToolContext,
): Promise<unknown> {
  const requestId = String(args.requestId || '').trim();
  if (!requestId) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'requestId required');

  const request = await pollRequestStatus(requestId);

  const status = request.status as string;
  const result = request.result as Record<string, unknown> | null;

  return {
    ok: true,
    requestId: request.id,
    status,
    actionType: request.actionType,
    txHash: request.txHash,
    result: result ?? null,
    jobId: result?.jobId ?? null,
    isTerminal: status === 'confirmed' || status === 'cancelled' || status === 'expired',
    statusMessage:
      status === 'pending' ? 'Waiting for user to approve in ArcLayer Profile.' :
      status === 'signing' ? 'User is signing the transaction.' :
      status === 'submitted' ? 'Transaction submitted, waiting for confirmation.' :
      status === 'confirmed' ? 'Transaction confirmed on-chain.' :
      status === 'cancelled' ? 'User rejected the request.' :
      status === 'expired' ? 'Request expired.' :
      `Status: ${status}`,
  };
}
