/**
 * ERC-8183 Production Read Model
 *
 * Builds canonical job detail with normalized lifecycle status,
 * timeline, proof/result hashes, tx hashes, and allowed actions.
 *
 * No fake status. No inferred completion from proof count.
 * Prefers on-chain status when erc8183JobId exists.
 */

import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import type { Erc8183JobView, Erc8183Status } from './types';
import { readOnchainJob, ONCHAIN_STATUS_MAP } from './receipt';

// ── Lifecycle Status ──────────────────────────────────────────────────────

export type LifecycleStatus =
  | 'LocalCreated'
  | 'CreatedOnchain'
  | 'BudgetSet'
  | 'Funded'
  | 'Claimed'
  | 'Running'
  | 'Submitted'
  | 'Completed'
  | 'Settled'
  | 'Expired'
  | 'Rejected'
  | 'Unknown';

/**
 * Normalize ERC-8183 lifecycle status from local job + optional on-chain state.
 *
 * Rules:
 * - LocalCreated: no createTxHash yet
 * - CreatedOnchain: has createTxHash + erc8183JobId, on-chain Open
 * - BudgetSet: has setBudgetTxHash
 * - Funded: on-chain Funded or has fundTxHash
 * - Claimed: local status='claimed' (off-chain only)
 * - Running: local status='running' (off-chain only)
 * - Submitted: on-chain Submitted or has submitTxHash
 * - Completed: on-chain Completed or has completeTxHash
 * - Settled: local status='settled'
 * - Expired: on-chain Expired
 * - Rejected: on-chain Rejected
 */
export function normalizeErc8183LifecycleStatus(
  job: Erc8183JobView,
  onchainStatus?: Erc8183Status | null,
): LifecycleStatus {
  // On-chain terminal/advanced states always win over stale local state
  if (onchainStatus) {
    if (onchainStatus === 'Rejected') return 'Rejected';
    if (onchainStatus === 'Expired') return 'Expired';

    if (onchainStatus === 'Completed') {
      return job.status === 'settled' ? 'Settled' : 'Completed';
    }

    if (onchainStatus === 'Submitted') return 'Submitted';

    if (onchainStatus === 'Funded') {
      // Allow local off-chain sub-states when on-chain is still Funded
      if (job.status === 'running') return 'Running';
      if (job.status === 'claimed') return 'Claimed';
      return 'Funded';
    }

    if (onchainStatus === 'Open') {
      return job.setBudgetTxHash ? 'BudgetSet' : 'CreatedOnchain';
    }
  }

  // Fallback to tx hashes when on-chain status unavailable
  if (job.completeTxHash) return job.status === 'settled' ? 'Settled' : 'Completed';
  if (job.submitTxHash) return 'Submitted';
  if (job.status === 'running') return 'Running';
  if (job.status === 'claimed') return 'Claimed';
  if (job.fundTxHash) return 'Funded';
  if (job.setBudgetTxHash) return 'BudgetSet';
  if (job.createTxHash && job.erc8183JobId) return 'CreatedOnchain';

  return 'LocalCreated';
}

// ── Timeline ──────────────────────────────────────────────────────────────

export interface TimelineEvent {
  type: string;
  actorAgentId?: string;
  actorRole?: string;
  txHash?: string;
  payloadHash?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Build timeline from job state + agent_job_events.
 * Events are sorted chronologically.
 */
export function buildErc8183Timeline(
  job: Erc8183JobView,
  dbEvents: Array<{
    event_type: string;
    actor_agent_id: string | null;
    tx_hash: string | null;
    payload_hash: string | null;
    metadata: unknown;
    created_at: string;
  }>,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Build a lookup of DB event timestamps by event_type for tx events
  const dbEventTs = new Map<string, string>();
  for (const ev of dbEvents) {
    if (ev.created_at && !dbEventTs.has(ev.event_type)) {
      dbEventTs.set(ev.event_type, ev.created_at);
    }
  }

  // Add tx-based events from job state, preferring DB event timestamps
  if (job.createTxHash) {
    events.push({
      type: 'create_tx_confirmed',
      txHash: job.createTxHash,
      createdAt: dbEventTs.get('create_tx_confirmed') ?? job.createdAt,
    });
  }
  if (job.setBudgetTxHash) {
    events.push({
      type: 'budget_set_tx_confirmed',
      txHash: job.setBudgetTxHash,
      createdAt: dbEventTs.get('budget_set_tx_confirmed') ?? job.createdAt,
    });
  }
  if (job.approveTxHash) {
    events.push({
      type: 'approve_tx_confirmed',
      txHash: job.approveTxHash,
      createdAt: dbEventTs.get('approve_tx_confirmed') ?? job.createdAt,
    });
  }
  if (job.fundTxHash) {
    events.push({
      type: 'fund_tx_confirmed',
      txHash: job.fundTxHash,
      createdAt: dbEventTs.get('fund_tx_confirmed') ?? job.createdAt,
    });
  }
  if (job.claimedAt) {
    events.push({
      type: 'worker_claimed',
      actorAgentId: job.workerId ?? undefined,
      actorRole: 'worker',
      createdAt: job.claimedAt,
    });
  }
  if (job.startedAt) {
    events.push({
      type: 'worker_running',
      actorAgentId: job.workerId ?? undefined,
      actorRole: 'worker',
      createdAt: job.startedAt,
    });
  }
  if (job.submitTxHash) {
    events.push({
      type: 'submit_tx_confirmed',
      txHash: job.submitTxHash,
      payloadHash: job.deliverableHash ?? undefined,
      createdAt: dbEventTs.get('submit_tx_confirmed') ?? job.createdAt,
    });
  }
  if (job.completeTxHash) {
    events.push({
      type: 'complete_tx_confirmed',
      txHash: job.completeTxHash,
      payloadHash: job.reasonHash ?? undefined,
      createdAt: dbEventTs.get('complete_tx_confirmed') ?? job.createdAt,
    });
  }

  // Merge DB events (for events not derivable from job state)
  for (const ev of dbEvents) {
    const alreadyHave = events.some((e) => e.type === ev.event_type);
    if (!alreadyHave) {
      events.push({
        type: ev.event_type,
        actorAgentId: ev.actor_agent_id ?? undefined,
        txHash: ev.tx_hash ?? undefined,
        payloadHash: ev.payload_hash ?? undefined,
        metadata: (ev.metadata as Record<string, unknown>) ?? undefined,
        createdAt: ev.created_at,
      });
    }
  }

  // Sort by createdAt
  events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return events;
}

// ── Allowed Actions ───────────────────────────────────────────────────────

export type ActorRole = 'buyer' | 'provider' | 'worker' | 'evaluator' | 'admin';

export function buildAllowedActions(
  job: Erc8183JobView,
  lifecycleStatus: LifecycleStatus,
): string[] {
  const actions: string[] = [];

  switch (lifecycleStatus) {
    case 'LocalCreated':
      actions.push('confirm_created');
      break;
    case 'CreatedOnchain':
      actions.push('set_budget');
      break;
    case 'BudgetSet':
      actions.push('approve', 'fund');
      break;
    case 'Funded':
      actions.push('claim');
      break;
    case 'Claimed':
      actions.push('running');
      break;
    case 'Running':
      actions.push('submit');
      break;
    case 'Submitted':
      actions.push('complete');
      break;
    case 'Completed':
    case 'Settled':
    case 'Expired':
    case 'Rejected':
      // Terminal states — no actions
      break;
  }

  // Reconcile is always available
  if (job.erc8183JobId) {
    actions.push('reconcile');
  }

  return actions;
}

/**
 * Compute a human-readable next action label from lifecycle status.
 * Read-only display only — no tx actions in PR #412.
 */
export function getNextActionLabel(ls: LifecycleStatus): string | null {
  switch (ls) {
    case 'LocalCreated':
      return 'Confirm Creation';
    case 'CreatedOnchain':
      return 'Set Budget';
    case 'BudgetSet':
      return 'Approve & Fund';
    case 'Funded':
      return 'Awaiting Worker';
    case 'Claimed':
    case 'Running':
      return 'In Progress';
    case 'Submitted':
      return 'Awaiting Evaluation';
    case 'Completed':
    case 'Settled':
      return 'Done';
    case 'Rejected':
      return 'Rejected';
    case 'Expired':
      return 'Expired';
    default:
      return null;
  }
}

// ── Job Detail ────────────────────────────────────────────────────────────

export interface Erc8183JobDetail {
  localJobId: string;
  erc8183JobId: string | null;
  settlementMode: 'erc8183_escrow';
  lifecycleStatus: LifecycleStatus;
  localStatus: string;
  onchainStatus: Erc8183Status | null;
  description: string | null;
  participants: {
    client: { agentId: string; address: string | null };
    provider: { agentId: string | null; address: string | null };
    evaluator: { agentId: string | null; address: string | null };
    worker: { agentId: string | null };
  };
  budget: {
    atomic: string;
    decimals: 6;
    formatted: string;
  };
  expiry: {
    expiredAtUnix: string | null;
    isExpired: boolean;
  };
  payloads: {
    inputPayload: Record<string, unknown>;
    inputPayloadHash: string;
    resultPayload: Record<string, unknown> | null;
    resultPayloadHash: string | null;
    proofPayload: Record<string, unknown> | null;
    proofPayloadHash: string | null;
    deliverableHash: string | null;
    reasonHash: string | null;
  };
  txHashes: {
    createTxHash: string | null;
    setBudgetTxHash: string | null;
    approveTxHash: string | null;
    fundTxHash: string | null;
    submitTxHash: string | null;
    completeTxHash: string | null;
  };
  timestamps: {
    createdAt: string;
    claimedAt: string | null;
    startedAt: string | null;
    submittedAt: string | null;
    settledAt: string | null;
  };
  timeline: TimelineEvent[];
  allowedActions: string[];
}

/**
 * Build full ERC-8183 job detail with normalized lifecycle status,
 * timeline, and allowed actions.
 */
export async function buildErc8183JobDetail(
  localJobId: string,
): Promise<Erc8183JobDetail | null> {
  const { getErc8183JobByLocalId } = await import('./store');
  const job = await getErc8183JobByLocalId(localJobId);
  if (!job) return null;

  // Read on-chain status if we have an erc8183JobId
  let onchainStatus: Erc8183Status | null = null;
  if (job.erc8183JobId) {
    try {
      const { readOnchainJobStatus } = await import('./receipt');
      onchainStatus = await readOnchainJobStatus(BigInt(job.erc8183JobId));
    } catch {
      // Non-fatal — on-chain read may fail
    }
  }

  const lifecycleStatus = normalizeErc8183LifecycleStatus(job, onchainStatus);

  // Read DB events for timeline
  const db = getSupabaseAdmin();
  const { data: dbEvents } = await db
    .from('agent_job_events')
    .select('event_type, actor_agent_id, tx_hash, payload_hash, metadata, created_at')
    .eq('job_id', localJobId)
    .order('created_at', { ascending: true });

  const timeline = buildErc8183Timeline(job, dbEvents ?? []);
  const allowedActions = buildAllowedActions(job, lifecycleStatus);

  // Format budget
  const budgetAtomic = BigInt(job.priceAtomic);
  const budgetFormatted = (Number(budgetAtomic) / 1_000_000).toFixed(6);

  // Check expiry
  const expiredAtUnix = job.expiredAtUnix;
  const isExpired = expiredAtUnix
    ? Date.now() / 1000 > Number(expiredAtUnix)
    : false;

  return {
    localJobId: job.localJobId,
    erc8183JobId: job.erc8183JobId,
    settlementMode: 'erc8183_escrow',
    lifecycleStatus,
    localStatus: job.status,
    onchainStatus,
    description: job.description,
    participants: {
      client: { agentId: job.buyerAgentId, address: job.clientAddress },
      provider: { agentId: job.providerAgentId, address: job.providerAddress },
      evaluator: { agentId: job.evaluatorAgentId, address: job.evaluatorAddress },
      worker: { agentId: job.workerId },
    },
    budget: {
      atomic: job.priceAtomic,
      decimals: 6,
      formatted: budgetFormatted,
    },
    expiry: {
      expiredAtUnix,
      isExpired,
    },
    payloads: {
      inputPayload: job.inputPayload,
      inputPayloadHash: job.inputPayloadHash,
      resultPayload: job.resultPayload,
      resultPayloadHash: job.resultPayloadHash,
      proofPayload: job.proofPayload,
      proofPayloadHash: job.proofPayloadHash,
      deliverableHash: job.deliverableHash,
      reasonHash: job.reasonHash,
    },
    txHashes: {
      createTxHash: job.createTxHash,
      setBudgetTxHash: job.setBudgetTxHash,
      approveTxHash: job.approveTxHash,
      fundTxHash: job.fundTxHash,
      submitTxHash: job.submitTxHash,
      completeTxHash: job.completeTxHash,
    },
    timestamps: {
      createdAt: job.createdAt,
      claimedAt: job.claimedAt,
      startedAt: job.startedAt,
      submittedAt: null, // TODO: add to store
      settledAt: null, // TODO: add to store
    },
    timeline,
    allowedActions,
  };
}
