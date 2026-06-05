/**
 * MCP ERC-8183 Lifecycle Tools — Full prepare + read tools.
 *
 * PR #459: Exposes safe ERC-8183 lifecycle tools through MCP.
 *
 * Two flows:
 * A. Direct hire: client knows provider → createJob(provider, ...) → lifecycle.
 * B. Open/global: provider=0x0 → setProvider → lifecycle.
 *
 * No backend signing. No private keys. No tx execution.
 * Returns unsigned tx instructions or read-only data only.
 */

import { encodeFunctionData, keccak256, toBytes, type Hex, type Address } from 'viem';
import { isAddress } from 'viem/utils';
import {
  ERC8183_AGENTIC_COMMERCE_ABI,
  USDC_ABI,
  CONTRACTS,
} from '@arclayer/sdk';
import { getArcPublicClient } from '@/lib/erc8183-jobs/receipt';
import { indexerUrl } from '@/lib/indexer';
import type { McpToolContext } from './registry';
import { MCP_ERRORS, McpError } from './errors';
import { resolveMcpSessionByToken } from '@/lib/agent-accounts/store';
import type { McpSession } from '@/lib/agent-accounts/types';

// ── Constants ─────────────────────────────────────────────────────────────

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ARC_CHAIN_ID = 5042002;
const ARC_RPC = 'https://rpc.testnet.arc.network';

/** On-chain ERC-8183 status enum values. */
const STATUS_LABELS: Record<number, string> = {
  0: 'Open',
  1: 'Funded',
  2: 'Submitted',
  3: 'Completed',
  4: 'Rejected',
  5: 'Expired',
};

// ── Pure Helpers ──────────────────────────────────────────────────────────

/** Parse a string to a positive bigint, throwing McpError on failure. */
export function parsePositiveBigInt(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `${label} must be a positive integer`);
  }
  const n = BigInt(trimmed);
  if (n <= 0n) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `${label} must be > 0`);
  }
  return n;
}

/** Convert a USDC decimal string (e.g. "1.5") to atomic units (6 decimals). */
export function parseUsdcToAtomic(value: string): bigint {
  const cleaned = value.trim().replace(',', '.');
  if (!cleaned || isNaN(Number(cleaned))) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'Invalid USDC amount');
  }
  const num = Number(cleaned);
  if (num <= 0) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'USDC amount must be > 0');
  }
  // Multiply by 1e6 and round to avoid floating point issues
  const atomic = Math.round(num * 1e6);
  return BigInt(atomic);
}

/** Format atomic USDC units (6 decimals) to human-readable string. */
export function formatAtomicUsdc(atomic: bigint | string): string {
  const n = Number(atomic) / 1e6;
  return `${n.toFixed(6)} USDC`;
}

/** Validate and return a bytes32 reason hash, or hash a reason string. */
export function resolveBytes32Reason(
  reasonHash?: string,
  reason?: string,
): Hex {
  if (reasonHash) {
    const trimmed = reasonHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'reasonHash must be 0x-prefixed 32-byte hex');
    }
    return trimmed as Hex;
  }
  if (reason) {
    const r = reason.trim();
    if (r.startsWith('0x') && r.length === 66) return r as Hex;
    return keccak256(toBytes(r)) as Hex;
  }
  return keccak256(toBytes('approved')) as Hex;
}

/** Validate and return a bytes32 deliverable hash, or hash a deliverable string. */
export function resolveDeliverableHash(
  deliverableHash?: string,
  deliverable?: string,
): Hex {
  if (deliverableHash) {
    const trimmed = deliverableHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'deliverableHash must be 0x-prefixed 32-byte hex');
    }
    return trimmed as Hex;
  }
  if (deliverable) {
    return keccak256(toBytes(deliverable.trim())) as Hex;
  }
  throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'deliverableHash or deliverable required');
}

/** Clamp deadline minutes to [15, 43200] and return as integer. */
export function clampDeadlineMinutes(minutes?: number): number {
  if (minutes === undefined || minutes === null) return 1440; // default 24h
  const n = Math.floor(Number(minutes));
  if (isNaN(n) || n < 1) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'deadlineMinutes must be a positive integer');
  }
  return Math.max(15, Math.min(43200, n));
}

/** Return human-readable status label for a numeric on-chain status. */
export function statusLabel(status: number | bigint | null | undefined): string {
  if (status === null || status === undefined) return 'Unknown';
  const n = Number(status);
  return STATUS_LABELS[n] ?? `Unknown(${n})`;
}

/** Determine if a job is in a terminal state. */
function isTerminal(status: number): boolean {
  return status === 3 || status === 4 || status === 5; // Completed, Rejected, Expired
}

/** Determine if a job is expired based on expiredAt timestamp. */
function isExpired(expiredAt: bigint): boolean {
  return BigInt(Math.floor(Date.now() / 1000)) > expiredAt;
}

/** Check if the SDK ABI has a specific function. */
export function hasAbiFunction(name: string): boolean {
  return (ERC8183_AGENTIC_COMMERCE_ABI as readonly Record<string, unknown>[]).some(
    (item) => item.type === 'function' && item.name === name,
  );
}

// ── Session Auth ──────────────────────────────────────────────────────────

/**
 * Extract and validate MCP session from tool context.
 * Throws McpError if not authenticated.
 */
async function requireMcpSession(ctx: McpToolContext): Promise<McpSession> {
  const auth = ctx.request.authorization;
  if (!auth) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'MCP Bearer token required');
  }

  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].startsWith('arc_mcp_sess_')) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Invalid MCP token format');
  }

  const session = await resolveMcpSessionByToken(match[1].trim());
  if (!session) {
    throw new McpError(MCP_ERRORS.UNAUTHORIZED, 'Invalid or expired MCP session');
  }

  return session;
}

/**
 * Build session context for responses.
 * recommendedSigner = agentAccountAddress if set, else ownerAddress.
 */
function sessionContext(session: McpSession) {
  const recommendedSigner = session.agentAccountAddress || session.ownerAddress;
  return {
    ownerAddress: session.ownerAddress,
    agentAccountAddress: session.agentAccountAddress,
    recommendedSigner,
  };
}

// ── Address Validation ────────────────────────────────────────────────────

function validateAddress(value: string, label: string): `0x${string}` {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `${label} is not a valid EVM address`);
  }
  return trimmed as `0x${string}`;
}

function validateNonZeroAddress(value: string, label: string): `0x${string}` {
  const addr = validateAddress(value, label);
  if (addr.toLowerCase() === ZERO_ADDRESS) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, `${label} must not be the zero address`);
  }
  return addr;
}

// ── Read Handlers ─────────────────────────────────────────────────────────

/**
 * jobs.get_onchain_status — Read on-chain job state via AgenticCommerce.getJob.
 * Falls back to indexer if contract read fails.
 */
export async function handleJobsGetOnchainStatus(
  args: Record<string, unknown>,
): Promise<unknown> {
  const jobIdRaw = String(args.jobId || '').trim();
  if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  const jobId = parsePositiveBigInt(jobIdRaw, 'jobId');

  let source: 'contract' | 'indexer' = 'contract';
  let job: Record<string, unknown> | null = null;

  // Try on-chain read first
  try {
    const client = getArcPublicClient();
    const result = await client.readContract({
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
      abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
      functionName: 'getJob',
      args: [jobId],
    });
    if (result) {
      const tuple = result as unknown as readonly [
        bigint, string, string, string, string, bigint, bigint, number, string,
      ];
      job = {
        id: tuple[0].toString(),
        client: tuple[1],
        provider: tuple[2],
        evaluator: tuple[3],
        description: tuple[4],
        budget: tuple[5].toString(),
        expiredAt: tuple[6].toString(),
        status: Number(tuple[7]),
        hook: tuple[8],
      };
    }
  } catch {
    source = 'indexer';
  }

  // Fallback to indexer
  if (!job) {
    try {
      const res = await fetch(indexerUrl(`/jobs/${encodeURIComponent(jobIdRaw)}`), {
        cache: 'no-store',
      });
      if (res.ok) {
        job = await res.json();
        source = 'indexer';
      }
    } catch {
      // Both failed
    }
  }

  if (!job) {
    throw new McpError(MCP_ERRORS.NOT_FOUND, `Job ${jobIdRaw} not found on-chain or in indexer`);
  }

  // Read additional on-chain data
  let hasBudget: boolean | null = null;
  let paymentToken: string | null = null;
  if (source === 'contract') {
    try {
      const client = getArcPublicClient();
      const [hb, pt] = await Promise.all([
        client.readContract({
          address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
          abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
          functionName: 'jobHasBudget',
          args: [jobId],
        }) as Promise<boolean>,
        client.readContract({
          address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
          abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
          functionName: 'paymentToken',
          args: [],
        }) as Promise<string>,
      ]);
      hasBudget = hb;
      paymentToken = pt;
    } catch {
      // Non-critical, omit
    }
  }

  const statusCode = Number((job as any).status ?? 0);

  return {
    ok: true,
    jobId: jobIdRaw,
    source,
    statusCode,
    statusLabel: statusLabel(statusCode),
    client: (job as any).client ?? null,
    provider: (job as any).provider ?? null,
    evaluator: (job as any).evaluator ?? null,
    description: (job as any).description ?? null,
    budgetAtomic: (job as any).budget ?? null,
    budgetUsdc: (job as any).budget ? formatAtomicUsdc((job as any).budget) : null,
    expiredAt: (job as any).expiredAt ?? null,
    hook: (job as any).hook ?? null,
    hasBudget,
    paymentToken,
    raw: job,
  };
}

/**
 * jobs.get_lifecycle_summary — Compute next actor/action from on-chain state.
 */
export async function handleJobsGetLifecycleSummary(
  args: Record<string, unknown>,
): Promise<unknown> {
  const jobIdRaw = String(args.jobId || '').trim();
  if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  const jobId = parsePositiveBigInt(jobIdRaw, 'jobId');

  // Read job on-chain
  let job: {
    client: string;
    provider: string;
    evaluator: string;
    budget: bigint;
    expiredAt: bigint;
    status: number;
  } | null = null;

  try {
    const client = getArcPublicClient();
    const result = await client.readContract({
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
      abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
      functionName: 'getJob',
      args: [jobId],
    });
    if (result) {
      const tuple = result as unknown as readonly [
        bigint, string, string, string, string, bigint, bigint, number, string,
      ];
      job = {
        client: tuple[1],
        provider: tuple[2],
        evaluator: tuple[3],
        budget: tuple[5],
        expiredAt: tuple[6],
        status: Number(tuple[7]),
      };
    }
  } catch {
    throw new McpError(MCP_ERRORS.NOT_FOUND, `Job ${jobIdRaw} not found on-chain`);
  }

  if (!job) {
    throw new McpError(MCP_ERRORS.NOT_FOUND, `Job ${jobIdRaw} not found on-chain`);
  }

  const expired = isExpired(job.expiredAt);
  const providerIsZero = job.provider.toLowerCase() === ZERO_ADDRESS;
  const hasBudget = job.budget > 0n;

  let nextActor: string;
  let nextAction: string;
  let recommendedTool: string;
  let notes: string[] = [];
  let terminal = false;

  switch (job.status) {
    case 0: // Open
      if (providerIsZero) {
        nextActor = 'client';
        nextAction = 'hire provider';
        recommendedTool = 'client.prepare_set_provider_for_session';
        notes.push('Open/global job — provider must be assigned before funding.');
      } else if (!hasBudget) {
        nextActor = 'client or provider';
        nextAction = 'set budget';
        recommendedTool = 'provider.prepare_set_budget_for_session';
        notes.push('Provider-set budget recommended for quote flow. Client-set budget also valid for fixed-price.');
      } else {
        nextActor = 'client';
        nextAction = 'approve + fund';
        recommendedTool = 'client.prepare_fund_job_bundle_for_session';
      }
      notes.push('Client can reject Open jobs.');
      break;

    case 1: // Funded
      if (expired) {
        nextActor = 'client';
        nextAction = 'claim refund (expired)';
        recommendedTool = 'client.prepare_claim_refund_for_session';
        notes.push('Job expired — client can claim refund.');
      } else {
        nextActor = 'provider';
        nextAction = 'submit';
        recommendedTool = 'provider.prepare_submit_job_for_session';
        notes.push('Alternatives: evaluator reject, claimRefund after expiry.');
      }
      break;

    case 2: // Submitted
      if (expired) {
        nextActor = 'client';
        nextAction = 'claim refund (expired)';
        recommendedTool = 'client.prepare_claim_refund_for_session';
        notes.push('Job expired — client can claim refund.');
      } else {
        nextActor = 'evaluator';
        nextAction = 'complete or reject';
        recommendedTool = 'evaluator.prepare_complete_job_for_session';
        notes.push('Alternative: evaluator.reject → refund to client. claimRefund after expiry.');
      }
      break;

    case 3: // Completed
      terminal = true;
      nextActor = 'none';
      nextAction = 'provider paid';
      recommendedTool = '';
      notes.push('Terminal — USDC released to provider.');
      break;

    case 4: // Rejected
      terminal = true;
      nextActor = 'none';
      nextAction = 'client refunded';
      recommendedTool = '';
      notes.push('Terminal — escrow returned to client.');
      break;

    case 5: // Expired
      terminal = true;
      nextActor = 'none';
      nextAction = 'client refunded';
      recommendedTool = '';
      notes.push('Terminal — escrow returned to client after expiry.');
      break;

    default:
      nextActor = 'unknown';
      nextAction = 'unknown status';
      recommendedTool = '';
      notes.push(`Unexpected status value: ${job.status}`);
  }

  return {
    ok: true,
    jobId: jobIdRaw,
    statusLabel: statusLabel(job.status),
    terminal,
    expired,
    nextActor,
    nextAction,
    recommendedTool: recommendedTool || null,
    notes,
  };
}

// ── Client Prepare Handlers ───────────────────────────────────────────────

/**
 * client.prepare_create_job_for_session — Direct hire flow.
 * Provider is required and must be non-zero.
 */
export async function handleClientPrepareCreateJobForSession(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const provider = validateNonZeroAddress(String(args.provider || ''), 'provider');
  const description = String(args.description || '').trim();
  if (!description) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'description required');
  if (description.length > 2048) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'description max 2048 chars');
  }

  let evaluator: `0x${string}`;
  if (args.evaluator && String(args.evaluator).trim()) {
    evaluator = validateAddress(String(args.evaluator), 'evaluator');
  } else {
    // Default to session owner (self-evaluation)
    evaluator = session.ownerAddress as `0x${string}`;
  }

  const deadlineMinutes = clampDeadlineMinutes(
    args.deadlineMinutes !== undefined ? Number(args.deadlineMinutes) : undefined,
  );
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60);

  const hook = args.hook && String(args.hook).trim()
    ? validateAddress(String(args.hook), 'hook')
    : ZERO_ADDRESS as `0x${string}`;

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
    functionName: 'createJob',
    args: [provider, evaluator, expiredAt, description, hook],
  });

  return {
    ok: true,
    chainId: ARC_CHAIN_ID,
    to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    data,
    value: '0x0',
    signingRequired: true,
    signing: {
      how: 'Send from the client wallet on Arc Testnet.',
      rpc: ARC_RPC,
      gasHint: '~300000',
      actor: 'client',
    },
    session: sessionContext(session),
    derived: {
      provider,
      evaluator,
      expiredAt: expiredAt.toString(),
      deadlineMinutes,
      hook,
      flow: 'direct_hire',
    },
    lifecycle: [
      '1. createJob → get jobId from JobCreated event',
      '2. provider/client calls setBudget(jobId, amount, "0x")',
      '3. USDC.approve(AgenticCommerce, amount)',
      '4. fund(jobId, "0x")',
      '5. submit(jobId, deliverableHash, "0x")',
      '6. complete(jobId, reasonHash, "0x")',
    ],
  };
}

/**
 * client.prepare_create_open_job_for_session — Open/global job board flow.
 * Provider is set to zero address; must be assigned later via setProvider.
 */
export async function handleClientPrepareCreateOpenJobForSession(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const description = String(args.description || '').trim();
  if (!description) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'description required');
  if (description.length > 2048) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'description max 2048 chars');
  }

  let evaluator: `0x${string}`;
  if (args.evaluator && String(args.evaluator).trim()) {
    evaluator = validateAddress(String(args.evaluator), 'evaluator');
  } else {
    evaluator = session.ownerAddress as `0x${string}`;
  }

  const deadlineMinutes = clampDeadlineMinutes(
    args.deadlineMinutes !== undefined ? Number(args.deadlineMinutes) : undefined,
  );
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + deadlineMinutes * 60);

  const hook = args.hook && String(args.hook).trim()
    ? validateAddress(String(args.hook), 'hook')
    : ZERO_ADDRESS as `0x${string}`;

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
    functionName: 'createJob',
    args: [ZERO_ADDRESS as Address, evaluator, expiredAt, description, hook],
  });

  return {
    ok: true,
    chainId: ARC_CHAIN_ID,
    to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    data,
    value: '0x0',
    signingRequired: true,
    signing: {
      how: 'Send from the client wallet on Arc Testnet.',
      rpc: ARC_RPC,
      gasHint: '~300000',
      actor: 'client',
    },
    session: sessionContext(session),
    derived: {
      provider: ZERO_ADDRESS,
      evaluator,
      expiredAt: expiredAt.toString(),
      deadlineMinutes,
      hook,
      flow: 'open_global',
    },
    notes: [
      'Open/global job — provider is address(0).',
      'After creation, assign a provider using client.prepare_set_provider_for_session.',
      'Budget and funding require a provider to be set first.',
    ],
    lifecycle: [
      '1. createJob(provider=0x0) → get jobId from JobCreated event',
      '2. client calls setProvider(jobId, provider) to assign provider',
      '3. provider/client calls setBudget(jobId, amount, "0x")',
      '4. USDC.approve(AgenticCommerce, amount)',
      '5. fund(jobId, "0x")',
      '6. submit(jobId, deliverableHash, "0x")',
      '7. complete(jobId, reasonHash, "0x")',
    ],
  };
}

/**
 * client.prepare_set_provider_for_session — Assign provider to open job.
 * Verified on-chain: setProvider(uint256 jobId, address provider_)
 */
export async function handleClientPrepareSetProviderForSession(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const jobIdRaw = String(args.jobId || '').trim();
  if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  const jobId = parsePositiveBigInt(jobIdRaw, 'jobId');
  const provider = validateNonZeroAddress(String(args.provider || ''), 'provider');

  // Optionally read on-chain state to warn
  let warning: string | null = null;
  try {
    const client = getArcPublicClient();
    const result = await client.readContract({
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
      abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
      functionName: 'getJob',
      args: [jobId],
    });
    if (result) {
      const tuple = result as unknown as readonly [
        bigint, string, string, string, string, bigint, bigint, number, string,
      ];
      const currentProvider = tuple[2];
      const status = Number(tuple[7]);
      if (currentProvider.toLowerCase() !== ZERO_ADDRESS) {
        warning = `Job already has provider ${currentProvider}. setProvider may revert.`;
      }
      if (status !== 0) {
        warning = `Job status is ${statusLabel(status)} (${status}). setProvider requires Open (0). May revert.`;
      }
    }
  } catch {
    // Non-critical — proceed without warning
  }

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
    functionName: 'setProvider',
    args: [jobId, provider],
  });

  return {
    ok: true,
    chainId: ARC_CHAIN_ID,
    to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    data,
    value: '0x0',
    signingRequired: true,
    signing: {
      how: 'Send from the client wallet. Job must be Open and current provider must be address(0). This hires/assigns a provider for an open job.',
      rpc: ARC_RPC,
      gasHint: '~80000',
      actor: 'client',
    },
    session: sessionContext(session),
    derived: {
      jobId: jobIdRaw,
      provider,
    },
    warning,
  };
}

/**
 * provider.prepare_set_budget_for_session — Set budget for a job.
 * Can be called by client or provider while job is Open.
 */
export async function handleProviderPrepareSetBudgetForSession(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const jobIdRaw = String(args.jobId || '').trim();
  if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  const jobId = parsePositiveBigInt(jobIdRaw, 'jobId');

  let amountAtomic: bigint;
  if (args.amountAtomic) {
    amountAtomic = parsePositiveBigInt(String(args.amountAtomic), 'amountAtomic');
  } else if (args.amountUsdc) {
    amountAtomic = parseUsdcToAtomic(String(args.amountUsdc));
  } else {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'amountAtomic or amountUsdc required');
  }

  const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
    functionName: 'setBudget',
    args: [jobId, amountAtomic, optParams],
  });

  return {
    ok: true,
    chainId: ARC_CHAIN_ID,
    to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    data,
    value: '0x0',
    signingRequired: true,
    signing: {
      how: 'Send from the provider or client, depending on the negotiation flow. Provider-set budget is recommended for provider quote flow.',
      rpc: ARC_RPC,
      gasHint: '~80000',
      actor: 'provider or client',
    },
    session: sessionContext(session),
    derived: {
      jobId: jobIdRaw,
      budgetAtomic: amountAtomic.toString(),
      budgetUsdc: formatAtomicUsdc(amountAtomic),
    },
  };
}

/**
 * client.prepare_fund_job_bundle_for_session — Approve + fund bundle.
 * Checks USDC allowance if clientAddress available. Returns ordered txs.
 */
export async function handleClientPrepareFundJobBundleForSession(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const jobIdRaw = String(args.jobId || '').trim();
  if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  const jobId = parsePositiveBigInt(jobIdRaw, 'jobId');
  const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;

  // Determine amount: from args or read budget from on-chain
  let amountAtomic: bigint | null = null;
  if (args.amountAtomic) {
    amountAtomic = parsePositiveBigInt(String(args.amountAtomic), 'amountAtomic');
  } else if (args.amountUsdc) {
    amountAtomic = parseUsdcToAtomic(String(args.amountUsdc));
  }

  // If amount not provided, read budget from getJob
  if (!amountAtomic) {
    try {
      const client = getArcPublicClient();
      const result = await client.readContract({
        address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
        abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
        functionName: 'getJob',
        args: [jobId],
      });
      if (result) {
        const tuple = result as unknown as readonly [
          bigint, string, string, string, string, bigint, bigint, number, string,
        ];
        amountAtomic = tuple[5]; // budget
        if (amountAtomic <= 0n) {
          throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'Job has no budget set. Call setBudget first.');
        }
      }
    } catch (e) {
      if (e instanceof McpError) throw e;
      throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'Could not read job budget. Provide amountAtomic or amountUsdc.');
    }
  }

  if (!amountAtomic || amountAtomic <= 0n) {
    throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'Invalid fund amount');
  }

  // Build fund tx
  const fundData = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
    functionName: 'fund',
    args: [jobId, optParams],
  });

  const fundTx = {
    to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    data: fundData,
    value: '0x0',
    label: 'fund',
  };

  // Check allowance if clientAddress provided
  const clientAddress = args.clientAddress ? String(args.clientAddress).trim() : null;
  let approveNeeded: boolean | null = null;
  let warning: string | null = null;

  if (clientAddress && isAddress(clientAddress)) {
    try {
      const client = getArcPublicClient();
      const allowance = await client.readContract({
        address: CONTRACTS.USDC as Address,
        abi: USDC_ABI as any,
        functionName: 'allowance',
        args: [clientAddress as Address, CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address],
      }) as bigint;

      if (allowance >= amountAtomic) {
        approveNeeded = false;
      } else {
        approveNeeded = true;
      }
    } catch {
      approveNeeded = null;
      warning = 'Could not read USDC allowance. Returning conservative approve + fund bundle.';
    }
  } else {
    approveNeeded = null;
    warning = 'clientAddress not provided. Returning conservative approve + fund bundle.';
  }

  // Build approve tx if needed
  const approveData = encodeFunctionData({
    abi: USDC_ABI as any,
    functionName: 'approve',
    args: [CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address, amountAtomic],
  });

  const approveTx = {
    to: CONTRACTS.USDC,
    data: approveData,
    value: '0x0',
    label: 'approve',
  };

  const txs = approveNeeded === false
    ? [fundTx]
    : [approveTx, fundTx];

  return {
    ok: true,
    chainId: ARC_CHAIN_ID,
    signingRequired: true,
    signing: {
      how: 'Send from the client wallet that holds USDC. Execute in order.',
      rpc: ARC_RPC,
      gasHint: approveNeeded === false ? '~120000' : '~170000 (approve + fund)',
      actor: 'client',
    },
    session: sessionContext(session),
    txs,
    derived: {
      jobId: jobIdRaw,
      amountAtomic: amountAtomic.toString(),
      amountUsdc: formatAtomicUsdc(amountAtomic),
      approveNeeded,
    },
    warning,
  };
}

/**
 * provider.prepare_submit_job_for_session — Submit deliverable.
 */
export async function handleProviderPrepareSubmitJobForSession(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const jobIdRaw = String(args.jobId || '').trim();
  if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  const jobId = parsePositiveBigInt(jobIdRaw, 'jobId');

  const deliverableHash = resolveDeliverableHash(
    args.deliverableHash ? String(args.deliverableHash) : undefined,
    args.deliverable ? String(args.deliverable) : undefined,
  );

  const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
    functionName: 'submit',
    args: [jobId, deliverableHash, optParams],
  });

  return {
    ok: true,
    chainId: ARC_CHAIN_ID,
    to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    data,
    value: '0x0',
    signingRequired: true,
    signing: {
      how: 'Send from the provider wallet assigned to this job.',
      rpc: ARC_RPC,
      gasHint: '~200000',
      actor: 'provider',
    },
    session: sessionContext(session),
    derived: {
      jobId: jobIdRaw,
      deliverableHash,
    },
    invariants: ['Only the designated provider can submit.', 'Job must be in Funded state.'],
  };
}

/**
 * evaluator.prepare_complete_job_for_session — Approve + settle.
 * Releases escrowed USDC to provider.
 */
export async function handleEvaluatorPrepareCompleteJobForSession(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const jobIdRaw = String(args.jobId || '').trim();
  if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  const jobId = parsePositiveBigInt(jobIdRaw, 'jobId');

  const reasonHash = resolveBytes32Reason(
    args.reasonHash ? String(args.reasonHash) : undefined,
    args.reason ? String(args.reason) : undefined,
  );

  const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
    functionName: 'complete',
    args: [jobId, reasonHash, optParams],
  });

  return {
    ok: true,
    chainId: ARC_CHAIN_ID,
    to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    data,
    value: '0x0',
    signingRequired: true,
    signing: {
      how: 'Send from the evaluator wallet. Releases escrowed USDC to provider.',
      rpc: ARC_RPC,
      gasHint: '~150000',
      actor: 'evaluator',
    },
    session: sessionContext(session),
    derived: {
      jobId: jobIdRaw,
      reasonHash,
    },
    invariants: ['Only the evaluator can call complete.', 'Job must have a submitted deliverable.'],
  };
}

/**
 * client.prepare_reject_job_for_session — Client rejects/cancels Open job.
 */
export async function handleClientPrepareRejectJobForSession(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const jobIdRaw = String(args.jobId || '').trim();
  if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  const jobId = parsePositiveBigInt(jobIdRaw, 'jobId');

  const reasonHash = resolveBytes32Reason(
    args.reasonHash ? String(args.reasonHash) : undefined,
    args.reason ? String(args.reason) : 'client_rejected',
  );

  const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;

  // Warn if job not Open
  let warning: string | null = null;
  try {
    const client = getArcPublicClient();
    const result = await client.readContract({
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
      abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
      functionName: 'getJob',
      args: [jobId],
    });
    if (result) {
      const tuple = result as unknown as readonly [
        bigint, string, string, string, string, bigint, bigint, number, string,
      ];
      const status = Number(tuple[7]);
      if (status !== 0) {
        warning = `Job status is ${statusLabel(status)} (${status}). Client reject is intended for Open (0) jobs. May revert.`;
      }
    }
  } catch {
    // Non-critical
  }

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
    functionName: 'reject',
    args: [jobId, reasonHash, optParams],
  });

  return {
    ok: true,
    chainId: ARC_CHAIN_ID,
    to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    data,
    value: '0x0',
    signingRequired: true,
    signing: {
      how: 'Send from the client wallet. Cancels an Open job before funding.',
      rpc: ARC_RPC,
      gasHint: '~100000',
      actor: 'client',
    },
    session: sessionContext(session),
    derived: {
      jobId: jobIdRaw,
      reasonHash,
    },
    warning,
  };
}

/**
 * evaluator.prepare_reject_job_for_session — Evaluator rejects Funded/Submitted job.
 * If escrow exists, funds are refunded to client.
 */
export async function handleEvaluatorPrepareRejectJobForSession(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const jobIdRaw = String(args.jobId || '').trim();
  if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  const jobId = parsePositiveBigInt(jobIdRaw, 'jobId');

  const reasonHash = resolveBytes32Reason(
    args.reasonHash ? String(args.reasonHash) : undefined,
    args.reason ? String(args.reason) : 'rejected',
  );

  const optParams = (String(args.optParams || '0x').trim() || '0x') as Hex;

  // Warn if job not Funded/Submitted
  let warning: string | null = null;
  try {
    const client = getArcPublicClient();
    const result = await client.readContract({
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
      abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
      functionName: 'getJob',
      args: [jobId],
    });
    if (result) {
      const tuple = result as unknown as readonly [
        bigint, string, string, string, string, bigint, bigint, number, string,
      ];
      const status = Number(tuple[7]);
      if (status !== 1 && status !== 2) {
        warning = `Job status is ${statusLabel(status)} (${status}). Evaluator reject is intended for Funded (1) or Submitted (2) jobs. May revert.`;
      }
    }
  } catch {
    // Non-critical
  }

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
    functionName: 'reject',
    args: [jobId, reasonHash, optParams],
  });

  return {
    ok: true,
    chainId: ARC_CHAIN_ID,
    to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    data,
    value: '0x0',
    signingRequired: true,
    signing: {
      how: 'Send from the evaluator wallet. Rejects a Funded or Submitted job. If escrow exists, funds are refunded to client.',
      rpc: ARC_RPC,
      gasHint: '~100000',
      actor: 'evaluator',
    },
    session: sessionContext(session),
    derived: {
      jobId: jobIdRaw,
      reasonHash,
    },
    warning,
  };
}

/**
 * client.prepare_claim_refund_for_session — Claim refund after expiry.
 * Returns escrow to client for expired Funded/Submitted jobs.
 * Signature: claimRefund(uint256 jobId) — no optParams.
 */
export async function handleClientPrepareClaimRefundForSession(
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<unknown> {
  const session = await requireMcpSession(ctx);
  const jobIdRaw = String(args.jobId || '').trim();
  if (!jobIdRaw) throw new McpError(MCP_ERRORS.VALIDATION_ERROR, 'jobId required');
  const jobId = parsePositiveBigInt(jobIdRaw, 'jobId');

  // Read on-chain state for warnings
  let expiredAt: bigint | null = null;
  let status: number | null = null;
  let warning: string | null = null;

  try {
    const client = getArcPublicClient();
    const result = await client.readContract({
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
      abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
      functionName: 'getJob',
      args: [jobId],
    });
    if (result) {
      const tuple = result as unknown as readonly [
        bigint, string, string, string, string, bigint, bigint, number, string,
      ];
      expiredAt = tuple[6];
      status = Number(tuple[7]);

      if (status !== 1 && status !== 2) {
        warning = `Job status is ${statusLabel(status)} (${status}). claimRefund is intended for Funded (1) or Submitted (2) jobs after expiry. May revert.`;
      } else if (!isExpired(expiredAt)) {
        const now = BigInt(Math.floor(Date.now() / 1000));
        const remaining = expiredAt - now;
        warning = `Job not yet expired. Expires at ${expiredAt} (in ~${Number(remaining) / 3600}h). claimRefund may revert before expiry.`;
      }
    }
  } catch {
    // Non-critical — proceed without warning
  }

  const data = encodeFunctionData({
    abi: ERC8183_AGENTIC_COMMERCE_ABI as any,
    functionName: 'claimRefund',
    args: [jobId],
  });

  return {
    ok: true,
    chainId: ARC_CHAIN_ID,
    to: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
    data,
    value: '0x0',
    signingRequired: true,
    signing: {
      how: 'Send from the client wallet (or anyone). Returns escrow to client after job expiry.',
      rpc: ARC_RPC,
      gasHint: '~100000',
      actor: 'client (or anyone)',
    },
    session: sessionContext(session),
    derived: {
      jobId: jobIdRaw,
      expiredAt: expiredAt?.toString() ?? null,
      now: Math.floor(Date.now() / 1000),
      refundable: status !== null && (status === 1 || status === 2) && expiredAt !== null && isExpired(expiredAt),
    },
    warning,
  };
}
