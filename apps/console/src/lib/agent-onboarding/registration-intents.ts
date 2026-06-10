import { randomUUID } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

const TABLE = 'mcp_registration_intents';
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

export type RegistrationIntentStatus = 'draft' | 'completed' | 'expired';

export type RegistrationIntentRecord = {
  id: string;
  mcpSessionId: string;
  ownerAddress: string;
  draftId: string;
  rolePresetId: string;
  status: RegistrationIntentStatus;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  agentId: string | null;
  txHash: string | null;
};

function mapRow(row: Record<string, unknown>): RegistrationIntentRecord {
  return {
    id: String(row.id),
    mcpSessionId: String(row.mcp_session_id),
    ownerAddress: String(row.owner_address),
    draftId: String(row.draft_id),
    rolePresetId: String(row.role_preset_id),
    status: String(row.status) as RegistrationIntentStatus,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    agentId: row.agent_id ? String(row.agent_id) : null,
    txHash: row.tx_hash ? String(row.tx_hash) : null,
  };
}

export async function createRegistrationIntent(input: {
  mcpSessionId: string;
  ownerAddress: string;
  draftId: string;
  rolePresetId: string;
}) {
  const supabase = getSupabaseAdmin();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INTENT_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      id,
      mcp_session_id: input.mcpSessionId,
      owner_address: input.ownerAddress.toLowerCase(),
      draft_id: input.draftId,
      role_preset_id: input.rolePresetId,
      expires_at: expiresAt,
    })
    .select('*')
    .single();

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, intent: mapRow(data as Record<string, unknown>) };
}

export async function getRegistrationIntent(id: string): Promise<RegistrationIntentRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}

export async function completeRegistrationIntent(input: { id: string; agentId: string; txHash: string }) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      agent_id: input.agentId,
      tx_hash: input.txHash,
    })
    .eq('id', input.id)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (data) return { ok: true as const, intent: mapRow(data as Record<string, unknown>) };

  const current = await getRegistrationIntent(input.id);
  if (!current) return { ok: false as const, error: 'intent_not_found' };

  if (current.status === 'completed') {
    const sameAgent = current.agentId === input.agentId;
    const sameTx = current.txHash?.toLowerCase() === input.txHash.toLowerCase();
    if (sameAgent && sameTx) {
      return { ok: true as const, idempotent: true as const, intent: current };
    }
    return { ok: false as const, conflict: true as const, error: 'intent_complete_conflict' };
  }

  return { ok: false as const, error: `intent_not_draft:${current.status}` };
}
