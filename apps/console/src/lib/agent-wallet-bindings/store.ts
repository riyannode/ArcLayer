/**
 * Agent Wallet Bindings — Supabase store.
 *
 * Data access layer for arclayer_agent_wallet_bindings table.
 * Maps agent_id → agent_account_address (Circle Agent Wallet).
 * Uses getSupabaseAdmin() (service_role, bypasses RLS).
 */

import { getAddress } from 'viem';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

const TABLE = 'arclayer_agent_wallet_bindings';

// ── Types ──────────────────────────────────────────────────────────────

export type AgentWalletBindingStatus = 'active' | 'inactive';
export type AgentWalletControllerMode = 'agent-account' | 'eoa';

export type AgentWalletBinding = {
  id: string;
  ownerAddress: `0x${string}`;
  agentId: string;
  agentAccountAddress: `0x${string}`;
  controllerMode: AgentWalletControllerMode;
  chainId: number;
  registrationTxHash: `0x${string}` | null;
  metadataUri: string | null;
  status: AgentWalletBindingStatus;
  createdAt: string;
  updatedAt: string;
};

export type UpsertAgentWalletBindingInput = {
  ownerAddress: string;
  agentId: string;
  agentAccountAddress: string;
  controllerMode?: AgentWalletControllerMode;
  chainId?: number;
  registrationTxHash?: string | null;
  metadataUri?: string | null;

  /**
   * Only set true after route has verified:
   * - current ERC-8004 ownerOf(agentId) === agentAccountAddress
   * - Agent Wallet control proof passed
   */
  allowOwnerTransferAfterOnchainProof?: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { code?: string; message?: string };
  return maybe.code === '23505' || String(maybe.message || '').toLowerCase().includes('unique');
}

function normalizeRow(row: Record<string, unknown>): AgentWalletBinding {
  return {
    id: String(row.id),
    ownerAddress: getAddress(String(row.owner_address)) as `0x${string}`,
    agentId: String(row.agent_id),
    agentAccountAddress: getAddress(String(row.agent_account_address)) as `0x${string}`,
    controllerMode: String(row.controller_mode || 'agent-account') as AgentWalletControllerMode,
    chainId: Number(row.chain_id || 5042002),
    registrationTxHash: row.registration_tx_hash
      ? (String(row.registration_tx_hash) as `0x${string}`)
      : null,
    metadataUri: row.metadata_uri ? String(row.metadata_uri) : null,
    status: String(row.status || 'active') as AgentWalletBindingStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ── Read ───────────────────────────────────────────────────────────────

export async function getActiveAgentWalletBindingByAgentId(
  agentId: string,
): Promise<AgentWalletBinding | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('agent_id', agentId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read Agent Wallet binding: ${error.message}`);
  }

  return data ? normalizeRow(data) : null;
}

export async function getActiveAgentWalletBindingsForOwner(
  ownerAddress: string,
): Promise<AgentWalletBinding[]> {
  const supabase = getSupabaseAdmin();
  const owner = getAddress(ownerAddress);

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('owner_address', owner.toLowerCase())
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to read owner Agent Wallet bindings: ${error.message}`);
  }

  return (data || []).map((row) => normalizeRow(row));
}

// ── Upsert ─────────────────────────────────────────────────────────────

export async function upsertActiveAgentWalletBinding(
  input: UpsertAgentWalletBindingInput,
): Promise<AgentWalletBinding> {
  const supabase = getSupabaseAdmin();

  const ownerAddress = getAddress(input.ownerAddress);
  const agentAccountAddress = getAddress(input.agentAccountAddress);
  const agentId = input.agentId.trim();

  if (!agentId) {
    throw new Error('agent_id_required');
  }

  // Check if active binding already exists for this agent_id
  const existing = await getActiveAgentWalletBindingByAgentId(agentId);
  const now = new Date().toISOString();

  if (existing && existing.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
    if (!input.allowOwnerTransferAfterOnchainProof) {
      throw new Error('agent_already_bound_to_different_owner');
    }

    // Deactivate stale binding — route has already verified:
    // - current ownerOf(agentId) === agentAccountAddress
    // - Agent Wallet control signature passed
    const { error: deactivateError } = await supabase
      .from(TABLE)
      .update({
        status: 'inactive',
        updated_at: now,
      })
      .eq('id', existing.id)
      .eq('status', 'active');

    if (deactivateError) {
      throw new Error(
        `Failed to deactivate stale Agent Wallet binding: ${deactivateError.message}`,
      );
    }
  }

  const payload = {
    owner_address: ownerAddress.toLowerCase(),
    agent_id: agentId,
    agent_account_address: agentAccountAddress.toLowerCase(),
    controller_mode: input.controllerMode || 'agent-account',
    chain_id: input.chainId || 5042002,
    registration_tx_hash: input.registrationTxHash || null,
    metadata_uri: input.metadataUri || null,
    status: 'active',
    updated_at: now,
  };

  // Update existing binding (same owner only — different owner was handled above)
  const sameOwnerExisting =
    existing && existing.ownerAddress.toLowerCase() === ownerAddress.toLowerCase()
      ? existing
      : null;

  if (sameOwnerExisting) {
    const { data, error } = await supabase
      .from(TABLE)
      .update(payload)
      .eq('id', sameOwnerExisting.id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to update Agent Wallet binding: ${error.message}`);
    }

    return normalizeRow(data);
  }

  // Insert new binding — handle unique conflict (race condition)
  const { data, error } = await supabase
    .from(TABLE)
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const existingAfterConflict = await getActiveAgentWalletBindingByAgentId(agentId);

      if (!existingAfterConflict) {
        throw new Error(
          `Failed to create Agent Wallet binding after unique conflict: ${error.message}`,
        );
      }

      if (existingAfterConflict.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new Error('agent_already_bound_to_different_owner');
      }

      const { data: updated, error: updateError } = await supabase
        .from(TABLE)
        .update(payload)
        .eq('id', existingAfterConflict.id)
        .select('*')
        .single();

      if (updateError) {
        throw new Error(
          `Failed to update Agent Wallet binding after unique conflict: ${updateError.message}`,
        );
      }

      return normalizeRow(updated);
    }

    throw new Error(`Failed to create Agent Wallet binding: ${error.message}`);
  }

  return normalizeRow(data);
}
