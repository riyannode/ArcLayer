import { createPublicClient, http, parseEventLogs, type Hash } from 'viem';
import { JOB_ESCROW_ABI, arcTestnet } from '@arclayer/sdk';
import type { X402Payment, X402Requirement } from './types';
import type { X402PaymentPayload } from './parser';
import { canonicalResource, normalizeTxHash } from './parser';
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  JOB_ESCROW_ADDRESS,
  USDC_ADDRESS,
} from './constants';
import { randomBytes } from 'crypto';

export type VerifyArcEscrowResult =
  | {
      ok: true;
      payment: X402Payment;
      event: {
        txHash: string;
        blockNumber: number;
        blockHash: string;
        logIndex: number;
        jobId: string;
        payer?: string;
        payTo: string;
        asset: string;
        amount: string;
      };
    }
  | {
      ok: false;
      code:
        | 'INVALID_CHAIN'
        | 'INVALID_TX_HASH'
        | 'TX_NOT_FOUND'
        | 'TX_REVERTED'
        | 'EVENT_NOT_FOUND'
        | 'INVALID_CONTRACT'
        | 'RESOURCE_MISMATCH'
        | 'JOB_ID_MISMATCH'
        | 'PAY_TO_MISMATCH'
        | 'ASSET_MISMATCH'
        | 'AMOUNT_TOO_LOW'
        | 'REQUIREMENT_EXPIRED'
        | 'REQUIREMENT_INACTIVE'
        | 'RPC_ERROR';
      message: string;
      details?: Record<string, unknown>;
    };

export interface VerifyArcEscrowInput {
  payment: X402PaymentPayload;
  requirement: X402Requirement;
  rpcUrl?: string;
  jobEscrowAddress?: string;
}

function paymentId(): string {
  return `pay_${randomBytes(16).toString('hex')}`;
}

function reject(code: VerifyArcEscrowResult extends infer T ? never : never, message: string): never {
  throw new Error(`${code}:${message}`);
}

function fail(code: Extract<VerifyArcEscrowResult, { ok: false }>['code'], message: string, details?: Record<string, unknown>): VerifyArcEscrowResult {
  return { ok: false, code, message, details };
}

function lower(value: string): string {
  return value.toLowerCase();
}

export async function verifyArcEscrowPayment(input: VerifyArcEscrowInput): Promise<VerifyArcEscrowResult> {
  const requirement = input.requirement;
  const paymentPayload = input.payment;
  const txHash = normalizeTxHash(paymentPayload.txHash);
  const jobEscrowAddress = input.jobEscrowAddress ?? JOB_ESCROW_ADDRESS;

  if (paymentPayload.chainId !== ARC_TESTNET_CHAIN_ID) {
    return fail('INVALID_CHAIN', `Unsupported chainId ${paymentPayload.chainId}`);
  }
  if (!txHash) return fail('INVALID_TX_HASH', 'Invalid txHash');
  if (requirement.status !== 'active') return fail('REQUIREMENT_INACTIVE', `Requirement status is ${requirement.status}`);
  if (Date.parse(requirement.expiresAt) <= Date.now()) return fail('REQUIREMENT_EXPIRED', 'Payment requirement has expired');
  if (paymentPayload.resource && canonicalResource(paymentPayload.resource) !== canonicalResource(requirement.resource)) {
    return fail('RESOURCE_MISMATCH', 'Payment resource does not match requirement resource');
  }
  if (lower(requirement.payTo) !== lower(jobEscrowAddress)) {
    return fail('PAY_TO_MISMATCH', 'Requirement payTo is not the configured JobEscrow address');
  }
  if (lower(requirement.asset) !== lower(USDC_ADDRESS)) {
    return fail('ASSET_MISMATCH', 'Requirement asset is not Arc testnet USDC');
  }

  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(input.rpcUrl ?? process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'),
  });

  const receipt = await client.getTransactionReceipt({ hash: txHash as Hash }).catch((error) => ({ error }));
  if ('error' in receipt) {
    return fail('RPC_ERROR', 'Failed to fetch transaction receipt', { error: String(receipt.error) });
  }
  if (!receipt) return fail('TX_NOT_FOUND', 'Payment tx receipt not found');
  if (receipt.status !== 'success') return fail('TX_REVERTED', 'Payment tx reverted');
  if (receipt.to && lower(receipt.to) !== lower(jobEscrowAddress)) {
    return fail('INVALID_CONTRACT', 'Payment tx did not target JobEscrow', { to: receipt.to });
  }

  let decoded;
  try {
    const logs = parseEventLogs({
      abi: JOB_ESCROW_ABI,
      eventName: 'JobFunded',
      logs: receipt.logs.filter((log) => lower(log.address) === lower(jobEscrowAddress)),
    });
    decoded = logs[0];
  } catch (error) {
    return fail('EVENT_NOT_FOUND', 'Failed to decode JobFunded event', { error: String(error) });
  }

  if (!decoded) return fail('EVENT_NOT_FOUND', 'Payment tx did not emit JobFunded event from JobEscrow');

  const args = decoded.args as { jobId?: bigint; client?: string; amount?: bigint };
  const fundedJobId = args.jobId?.toString();
  const fundedClient = args.client;
  const fundedAmount = args.amount?.toString();

  if (!fundedJobId || !fundedAmount) return fail('EVENT_NOT_FOUND', 'Decoded JobFunded event missing jobId or amount');
  if (requirement.jobId && requirement.jobId !== fundedJobId) {
    return fail('JOB_ID_MISMATCH', `Payment jobId mismatch: expected ${requirement.jobId}, got ${fundedJobId}`);
  }
  if (BigInt(fundedAmount) < BigInt(requirement.amountRequired)) {
    return fail('AMOUNT_TOO_LOW', `Payment amount ${fundedAmount} below required ${requirement.amountRequired}`);
  }

  const now = new Date().toISOString();
  const event = {
    txHash,
    blockNumber: Number(receipt.blockNumber),
    blockHash: receipt.blockHash,
    logIndex: decoded.logIndex,
    jobId: fundedJobId,
    payer: fundedClient?.toLowerCase(),
    payTo: jobEscrowAddress,
    asset: requirement.asset,
    amount: fundedAmount,
  };

  return {
    ok: true,
    event,
    payment: {
      paymentId: paymentId(),
      requirementId: requirement.requirementId,
      txHash,
      chainId: ARC_TESTNET_CHAIN_ID,
      scheme: 'arc-escrow',
      network: ARC_TESTNET_NETWORK,
      payer: event.payer,
      payTo: jobEscrowAddress,
      asset: requirement.asset,
      amount: fundedAmount,
      jobId: fundedJobId,
      resource: requirement.resource,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      logIndex: event.logIndex,
      eventName: 'JobFunded',
      verificationPayload: { event, receiptTo: receipt.to, requirementId: requirement.requirementId },
      settlementPayload: {},
      status: 'verified',
      verifiedAt: now,
      expiresAt: requirement.expiresAt,
      createdAt: now,
      updatedAt: now,
    },
  };
}
