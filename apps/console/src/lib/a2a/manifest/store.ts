import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { parseManifest } from './parse';
import type { AgentManifestV1, StoredAgentManifest } from './types';

const TABLE = 'agent_manifests';

export async function getManifest(agentId: string): Promise<StoredAgentManifest | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .select('agent_id, controller, manifest, manifest_hash, signature, signer, updated_at')
    .eq('agent_id', agentId)
    .maybeSingle();

  if (error) {
    console.error('[manifest.store] read error', error.message);
    return null;
  }
  if (!data) return null;

  const parsed = parseManifest(data.manifest);
  if (!parsed.ok) {
    console.warn(`[manifest.store] stored manifest for ${agentId} is invalid:`, parsed.error);
    return null;
  }

  return {
    agentId: data.agent_id,
    controller: data.controller ?? null,
    manifest: parsed.manifest,
    manifestHash: data.manifest_hash,
    signature: data.signature ?? null,
    signer: data.signer ?? null,
    updatedAt: data.updated_at,
  };
}

export async function getManifests(agentIds: string[]): Promise<Map<string, StoredAgentManifest>> {
  const out = new Map<string, StoredAgentManifest>();
  if (agentIds.length === 0) return out;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .select('agent_id, controller, manifest, manifest_hash, signature, signer, updated_at')
    .in('agent_id', agentIds);

  if (error || !data) {
    if (error) console.error('[manifest.store] batch read error', error.message);
    return out;
  }

  for (const row of data) {
    const parsed = parseManifest(row.manifest);
    if (!parsed.ok) continue;
    out.set(row.agent_id, {
      agentId: row.agent_id,
      controller: row.controller ?? null,
      manifest: parsed.manifest,
      manifestHash: row.manifest_hash,
      signature: row.signature ?? null,
      signer: row.signer ?? null,
      updatedAt: row.updated_at,
    });
  }
  return out;
}

export async function upsertManifest(input: {
  agentId: string;
  controller: string;
  manifest: AgentManifestV1;
  manifestHash: string;
  signature: string;
  signer: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        agent_id: input.agentId,
        controller: input.controller.toLowerCase(),
        manifest: input.manifest,
        manifest_hash: input.manifestHash,
        signature: input.signature,
        signer: input.signer.toLowerCase(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'agent_id' }
    );

  if (error) {
    console.error('[manifest.store] upsert error', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
