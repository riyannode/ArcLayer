/**
 * MCP Approval Engine — Store + State Machine.
 *
 * Every on-chain action from an MCP session must go through an approval.
 * The approval is created → approved → submitted → confirmed (or failed).
 *
 * Status transitions:
 *   awaiting_approval → approved → submitted → confirmed
 *                     → cancelled (from awaiting_approval or approved)
 *                     → failed (from submitted via confirmed with receiptStatus=reverted)
 *                     → expired (computed from expires_at)
 *
 * Security:
 * - Policy is enforced INSIDE createApproval — callers cannot bypass.
 * - Approval is single-use.
 * - Wrong session cannot read/update approval.
 * - Cancelled cannot be submitted.
 * - Expired cannot be approved/submitted.
 * - Submitted cannot be resubmitted with different txHash.
 * - No tx execution here — caller (frontend/executor) handles signing.
 */

import { randomBytes } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import type { McpSession } from '@/lib/agent-accounts/types';
import { checkPolicyV1, snapshotPolicy, type PolicyCheckInput } from '@/lib/mcp/policy';

// ── Types ─────────────────────────────────────────────────────────────────

export type ApprovalStatus =
  | 'awaiting_approval'
  | 'approved'
  | 'cancelled'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'expired';

export interface McpActionApproval {
  id: string;
  sessionId: string;
  ownerAddress: string;
  agentAccountAddress: string;
  action: string;
  chainId: number;
  toAddress: string;
  data: string;
  value: string;
  summary: Record<string, unknown>;
  policySnapshot: Record<string, unknown>;
  status: ApprovalStatus;
  txHash: string | null;
  error: string | null;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  cancelledAt: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
}

export interface CreateApprovalParams {
  session: McpSession;
  action: string;
  chainId: number;
  toAddress: string;
  data: string;
  value?: string;
  summary?: Record<string, unknown>;
  /** Contract identifier (e.g. 'ERC8004_IDENTITY_REGISTRY'). Required for policy check. */
  contract: string;
  /** TTL in minutes. Default 10, range 10–15. */
  ttlMinutes?: number;
}

export interface TransitionResult {
  ok: true;
  approval: McpActionApproval;
}

export interface TransitionError {
  ok: false;
  error: string;
  detail?: string;
}

export type TransitionResponse = TransitionResult | TransitionError;

// ── Constants ─────────────────────────────────────────────────────────────

const APPROVAL_ID_PREFIX = 'approval_';
const DEFAULT_TTL_MINUTES = 10;
const MIN_TTL_MINUTES = 10;
const MAX_TTL_MINUTES = 15;

// ── Helpers ───────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function ttlIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function generateApprovalId(): string {
  return APPROVAL_ID_PREFIX + randomBytes(16).toString('hex');
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

// ── Create ────────────────────────────────────────────────────────────────

/**
 * Create a new approval.
 * Policy is enforced INTERNALLY — callers cannot bypass policy checks.
 * If policy rejects, returns { ok: false, error: 'policy_denied', detail: reason }.
 */
export async function createApproval(
  params: CreateApprovalParams,
): Promise<TransitionResponse> {
  const { session, action, chainId, toAddress, data, summary, contract } = params;
  const supabase = getSupabaseAdmin();
  const now = nowIso();

  const value = params.value ?? '0x0';

  // ── Policy enforcement (INTERNAL — not caller-provided) ──
  const policyInput: PolicyCheckInput = {
    session,
    chainId,
    toAddress,
    action,
    data,
    value,
    contract,
  };
  const policyResult = checkPolicyV1(policyInput);
  if (!policyResult.allowed) {
    return {
      ok: false,
      error: 'policy_denied',
      detail: policyResult.reason,
    };
  }

  // Generate server-side policy snapshot (never trust caller-provided snapshot)
  const policySnapshot = snapshotPolicy(policyInput, policyResult);

  const ttlMinutes = Math.max(
    MIN_TTL_MINUTES,
    Math.min(MAX_TTL_MINUTES, Math.floor(params.ttlMinutes ?? DEFAULT_TTL_MINUTES)),
  );
  const expiresAt = ttlIso(ttlMinutes);

  const id = generateApprovalId();

  const { data: row, error } = await supabase
    .from('mcp_action_approvals')
    .insert({
      id,
      session_id: session.id,
      owner_address: session.ownerAddress.toLowerCase(),
      agent_account_address: session.agentAccountAddress.toLowerCase(),
      action,
      chain_id: chainId,
      to_address: toAddress.toLowerCase(),
      data,
      value,
      summary_json: summary ?? {},
      policy_snapshot_json: policySnapshot,
      status: 'awaiting_approval',
      created_at: now,
      expires_at: expiresAt,
    })
    .select('*')
    .single();

  if (error) {
    return { ok: false, error: 'approval_create_failed', detail: error.message };
  }

  return { ok: true, approval: mapApprovalRow(row as Record<string, unknown>) };
}

// ── Read ──────────────────────────────────────────────────────────────────

/**
 * Get an approval by ID, scoped to a session.
 * Returns null if not found or belongs to different session.
 */
export async function getApproval(
  approvalId: string,
  sessionId: string,
): Promise<McpActionApproval | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('mcp_action_approvals')
    .select('*')
    .eq('id', approvalId)
    .eq('session_id', sessionId)
    .maybeSingle();

  if (error || !data) return null;
  return mapApprovalRow(data as Record<string, unknown>);
}

/**
 * Get an approval by ID without session scoping.
 * Used by the approval page where user authenticates via wallet cookie.
 * Caller MUST verify ownerAddress matches the authenticated wallet.
 */
export async function getApprovalById(
  approvalId: string,
): Promise<McpActionApproval | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('mcp_action_approvals')
    .select('*')
    .eq('id', approvalId)
    .maybeSingle();

  if (error || !data) return null;
  return mapApprovalRow(data as Record<string, unknown>);
}

/**
 * Get the effective status of an approval.
 * Returns 'expired' if the approval has expired but status wasn't updated yet.
 */
export function getEffectiveStatus(approval: McpActionApproval): ApprovalStatus {
  if (approval.status === 'awaiting_approval' || approval.status === 'approved') {
    if (isExpired(approval.expiresAt)) {
      return 'expired';
    }
  }
  return approval.status;
}

// ── Transitions ───────────────────────────────────────────────────────────

/**
 * Transition: awaiting_approval → approved.
 * Rejects if expired, cancelled, submitted, confirmed, or wrong session.
 */
export async function approveApproval(
  approvalId: string,
  session: McpSession,
): Promise<TransitionResponse> {
  const approval = await getApproval(approvalId, session.id);
  if (!approval) {
    return { ok: false, error: 'approval_not_found' };
  }

  const effective = getEffectiveStatus(approval);
  if (effective === 'expired') {
    return { ok: false, error: 'approval_expired' };
  }
  if (effective !== 'awaiting_approval') {
    return { ok: false, error: `invalid_transition:${effective}_to_approved` };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('mcp_action_approvals')
    .update({ status: 'approved', approved_at: nowIso() })
    .eq('id', approvalId)
    .eq('session_id', session.id)
    .eq('status', 'awaiting_approval')
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'approve_failed' };
  }

  return { ok: true, approval: mapApprovalRow(data as Record<string, unknown>) };
}

/**
 * Transition: awaiting_approval or approved → cancelled.
 * Idempotent if already cancelled by same session.
 */
export async function cancelApproval(
  approvalId: string,
  session: McpSession,
): Promise<TransitionResponse> {
  const approval = await getApproval(approvalId, session.id);
  if (!approval) {
    return { ok: false, error: 'approval_not_found' };
  }

  const effective = getEffectiveStatus(approval);

  // Already cancelled — idempotent
  if (effective === 'cancelled') {
    return { ok: true, approval };
  }

  // Can only cancel from awaiting_approval or approved
  if (effective !== 'awaiting_approval' && effective !== 'approved') {
    return { ok: false, error: `invalid_transition:${effective}_to_cancelled` };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('mcp_action_approvals')
    .update({ status: 'cancelled', cancelled_at: nowIso() })
    .eq('id', approvalId)
    .eq('session_id', session.id)
    .in('status', ['awaiting_approval', 'approved'])
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'cancel_failed' };
  }

  return { ok: true, approval: mapApprovalRow(data as Record<string, unknown>) };
}

/**
 * Transition: approved → submitted.
 * Requires valid txHash. No tx execution here.
 * Cannot resubmit with different txHash.
 */
export async function submitApproval(
  approvalId: string,
  session: McpSession,
  txHash: string,
): Promise<TransitionResponse> {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, error: 'invalid_tx_hash' };
  }

  const approval = await getApproval(approvalId, session.id);
  if (!approval) {
    return { ok: false, error: 'approval_not_found' };
  }

  const effective = getEffectiveStatus(approval);
  if (effective === 'expired') {
    return { ok: false, error: 'approval_expired' };
  }
  if (effective === 'cancelled') {
    return { ok: false, error: 'approval_cancelled' };
  }
  if (effective !== 'approved') {
    return { ok: false, error: `invalid_transition:${effective}_to_submitted` };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('mcp_action_approvals')
    .update({ status: 'submitted', tx_hash: txHash, submitted_at: nowIso() })
    .eq('id', approvalId)
    .eq('session_id', session.id)
    .eq('status', 'approved')
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'submit_failed' };
  }

  return { ok: true, approval: mapApprovalRow(data as Record<string, unknown>) };
}

/**
 * Transition: submitted → confirmed or failed.
 *
 * STRICT rules:
 * - receiptStatus MUST be exactly "success" or "reverted".
 * - Empty body is rejected.
 * - If txHash is provided, it MUST match the already-submitted txHash.
 * - Never overwrites submitted txHash with a different txHash.
 * - submitted → confirmed only if receiptStatus="success".
 * - submitted → failed only if receiptStatus="reverted".
 */
export async function confirmApproval(
  approvalId: string,
  session: McpSession,
  params: { txHash?: string; blockNumber?: number; receiptStatus: string },
): Promise<TransitionResponse> {
  // Strict: require receiptStatus
  if (params.receiptStatus !== 'success' && params.receiptStatus !== 'reverted') {
    return {
      ok: false,
      error: 'invalid_receipt_status',
      detail: 'receiptStatus must be exactly "success" or "reverted".',
    };
  }

  const approval = await getApproval(approvalId, session.id);
  if (!approval) {
    return { ok: false, error: 'approval_not_found' };
  }

  if (approval.status !== 'submitted') {
    return { ok: false, error: `invalid_transition:${approval.status}_to_confirmed` };
  }

  // If caller provides txHash, it must match the submitted txHash
  if (params.txHash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(params.txHash)) {
      return { ok: false, error: 'invalid_tx_hash' };
    }
    if (approval.txHash && params.txHash.toLowerCase() !== approval.txHash.toLowerCase()) {
      return {
        ok: false,
        error: 'tx_hash_mismatch',
        detail: `Submitted txHash is ${approval.txHash}, cannot overwrite with ${params.txHash}.`,
      };
    }
  }

  const newStatus = params.receiptStatus === 'reverted' ? 'failed' : 'confirmed';
  const updateFields: Record<string, unknown> = {
    status: newStatus,
    confirmed_at: nowIso(),
  };

  // Never overwrite txHash — only set if not already set
  if (params.txHash && !approval.txHash) {
    updateFields.tx_hash = params.txHash;
  }

  if (newStatus === 'failed') {
    updateFields.error = 'transaction_reverted';
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('mcp_action_approvals')
    .update(updateFields)
    .eq('id', approvalId)
    .eq('session_id', session.id)
    .eq('status', 'submitted')
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'confirm_failed' };
  }

  return { ok: true, approval: mapApprovalRow(data as Record<string, unknown>) };
}

// ── Wallet-auth transitions (for approval page) ──────────────────────────
// These functions operate on an already-fetched approval where the caller
// has already verified wallet ownership. No session scoping in the DB query.

/**
 * Approve an approval via wallet auth.
 * Caller must verify approval.ownerAddress matches authenticated wallet.
 */
export async function approveApprovalByWallet(
  approval: McpActionApproval,
): Promise<TransitionResponse> {
  const effective = getEffectiveStatus(approval);
  if (effective === 'expired') {
    return { ok: false, error: 'approval_expired' };
  }
  if (effective !== 'awaiting_approval') {
    return { ok: false, error: `invalid_transition:${effective}_to_approved` };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('mcp_action_approvals')
    .update({ status: 'approved', approved_at: nowIso() })
    .eq('id', approval.id)
    .eq('status', 'awaiting_approval')
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'approve_failed' };
  }

  return { ok: true, approval: mapApprovalRow(data as Record<string, unknown>) };
}

/**
 * Cancel an approval via wallet auth.
 * Caller must verify approval.ownerAddress matches authenticated wallet.
 */
export async function cancelApprovalByWallet(
  approval: McpActionApproval,
): Promise<TransitionResponse> {
  const effective = getEffectiveStatus(approval);

  if (effective === 'cancelled') {
    return { ok: true, approval };
  }

  if (effective !== 'awaiting_approval' && effective !== 'approved') {
    return { ok: false, error: `invalid_transition:${effective}_to_cancelled` };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('mcp_action_approvals')
    .update({ status: 'cancelled', cancelled_at: nowIso() })
    .eq('id', approval.id)
    .in('status', ['awaiting_approval', 'approved'])
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'cancel_failed' };
  }

  return { ok: true, approval: mapApprovalRow(data as Record<string, unknown>) };
}

/**
 * Submit txHash for an approval via wallet auth.
 * Caller must verify approval.ownerAddress matches authenticated wallet.
 */
export async function submitApprovalByWallet(
  approval: McpActionApproval,
  txHash: string,
): Promise<TransitionResponse> {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, error: 'invalid_tx_hash' };
  }

  const effective = getEffectiveStatus(approval);
  if (effective === 'expired') {
    return { ok: false, error: 'approval_expired' };
  }
  if (effective === 'cancelled') {
    return { ok: false, error: 'approval_cancelled' };
  }
  if (effective !== 'approved') {
    return { ok: false, error: `invalid_transition:${effective}_to_submitted` };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('mcp_action_approvals')
    .update({ status: 'submitted', tx_hash: txHash, submitted_at: nowIso() })
    .eq('id', approval.id)
    .eq('status', 'approved')
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'submit_failed' };
  }

  return { ok: true, approval: mapApprovalRow(data as Record<string, unknown>) };
}

/**
 * Confirm an approval via wallet auth.
 * Caller must verify approval.ownerAddress matches authenticated wallet.
 */
export async function confirmApprovalByWallet(
  approval: McpActionApproval,
  params: { txHash?: string; blockNumber?: number; receiptStatus: string },
): Promise<TransitionResponse> {
  if (params.receiptStatus !== 'success' && params.receiptStatus !== 'reverted') {
    return {
      ok: false,
      error: 'invalid_receipt_status',
      detail: 'receiptStatus must be exactly "success" or "reverted".',
    };
  }

  if (approval.status !== 'submitted') {
    return { ok: false, error: `invalid_transition:${approval.status}_to_confirmed` };
  }

  if (params.txHash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(params.txHash)) {
      return { ok: false, error: 'invalid_tx_hash' };
    }
    if (approval.txHash && params.txHash.toLowerCase() !== approval.txHash.toLowerCase()) {
      return {
        ok: false,
        error: 'tx_hash_mismatch',
        detail: `Submitted txHash is ${approval.txHash}, cannot overwrite with ${params.txHash}.`,
      };
    }
  }

  const newStatus = params.receiptStatus === 'reverted' ? 'failed' : 'confirmed';
  const updateFields: Record<string, unknown> = {
    status: newStatus,
    confirmed_at: nowIso(),
  };

  if (params.txHash && !approval.txHash) {
    updateFields.tx_hash = params.txHash;
  }

  if (newStatus === 'failed') {
    updateFields.error = 'transaction_reverted';
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('mcp_action_approvals')
    .update(updateFields)
    .eq('id', approval.id)
    .eq('status', 'submitted')
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'confirm_failed' };
  }

  return { ok: true, approval: mapApprovalRow(data as Record<string, unknown>) };
}

// ── Row mapper ────────────────────────────────────────────────────────────

function mapApprovalRow(row: Record<string, unknown>): McpActionApproval {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    ownerAddress: String(row.owner_address),
    agentAccountAddress: String(row.agent_account_address),
    action: String(row.action),
    chainId: Number(row.chain_id),
    toAddress: String(row.to_address),
    data: String(row.data),
    value: String(row.value ?? '0x0'),
    summary: (row.summary_json ?? {}) as Record<string, unknown>,
    policySnapshot: (row.policy_snapshot_json ?? {}) as Record<string, unknown>,
    status: String(row.status) as ApprovalStatus,
    txHash: row.tx_hash ? String(row.tx_hash) : null,
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
  };
}
