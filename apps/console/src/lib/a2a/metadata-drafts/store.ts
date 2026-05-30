import { createHash, randomUUID } from 'crypto';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';

const TABLE = 'agent_metadata_drafts';

function hashWriteToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export type MetadataDraftRecord = {
  draftId: string;
  controller: string;
  metadata: unknown;
  status: 'draft' | 'minted';
  agentId: string | null;
  txHash: string | null;
  updatedAt: string;
};

export async function createMetadataDraft(input: {
  controller: string;
  metadata: unknown;
}) {
  const supabase = getSupabaseAdmin();
  const draftId = randomUUID();
  const writeToken = randomUUID();

  const { error } = await supabase.from(TABLE).insert({
    draft_id: draftId,
    controller: input.controller.toLowerCase(),
    metadata: input.metadata,
    write_token_hash: hashWriteToken(writeToken),
  });

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return {
    ok: true as const,
    draftId,
    writeToken,
  };
}

export async function getMetadataDraft(draftId: string): Promise<MetadataDraftRecord | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from(TABLE)
    .select('draft_id, controller, metadata, status, agent_id, tx_hash, updated_at')
    .eq('draft_id', draftId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    draftId: data.draft_id,
    controller: data.controller,
    metadata: data.metadata,
    status: data.status,
    agentId: data.agent_id,
    txHash: data.tx_hash,
    updatedAt: data.updated_at,
  };
}

export async function getAgentsByController(
  controller: string,
): Promise<MetadataDraftRecord[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from(TABLE)
    .select('draft_id, controller, metadata, status, agent_id, tx_hash, updated_at')
    .eq('controller', controller.toLowerCase())
    .eq('status', 'minted')
    .not('agent_id', 'is', null)
    .order('updated_at', { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    draftId: row.draft_id,
    controller: row.controller,
    metadata: row.metadata,
    status: row.status,
    agentId: row.agent_id,
    txHash: row.tx_hash,
    updatedAt: row.updated_at,
  }));
}

export async function updateMetadataDraft(input: {
  draftId: string;
  writeToken: string;
  metadata: unknown;
  agentId?: string;
  txHash?: string;
}) {
  const supabase = getSupabaseAdmin();

  const { data, error: readError } = await supabase
    .from(TABLE)
    .select('write_token_hash')
    .eq('draft_id', input.draftId)
    .maybeSingle();

  if (readError || !data) {
    return { ok: false as const, error: 'draft not found' };
  }

  if (data.write_token_hash !== hashWriteToken(input.writeToken)) {
    return { ok: false as const, error: 'invalid write token' };
  }

  const updateFields: Record<string, unknown> = {
    metadata: input.metadata,
  };

  if (input.agentId) {
    updateFields.agent_id = input.agentId;
    updateFields.status = 'minted';
  }

  if (input.txHash) {
    updateFields.tx_hash = input.txHash;
  }

  const { error } = await supabase
    .from(TABLE)
    .update(updateFields)
    .eq('draft_id', input.draftId);

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}
