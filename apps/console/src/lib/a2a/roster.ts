import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { parseManifest } from './manifest/parse';
import type { AgentManifestV1, StoredAgentManifest } from './manifest/types';
import type { AgentMatchCandidate } from './match-agents';

const TABLE = 'agent_manifests';

/**
 * Convert a stored AgentManifestV1 into a matcher-ready AgentMatchCandidate.
 *
 * Phase 10 — replaces the static ROSTER hardcoded in /api/x402/jobs/[id]/route.
 * The matcher contract stays unchanged; only the source of agents is now dynamic
 * (Supabase agent_manifests written by /api/a2a/register).
 */
export function manifestToCandidate(manifest: AgentManifestV1): AgentMatchCandidate {
  // Manifest may declare child roles; expose the first child role's category info too
  // by merging roles[].category into top-level categories. Matcher already handles
  // child-role role/capability matching via roles?.[].id and capabilities arrays.
  const roleCategories = (manifest.roles ?? [])
    .map((r) => r.category)
    .filter((c): c is string => typeof c === 'string' && c.length > 0);

  const categories = Array.from(
    new Set([...(manifest.categories ?? []), ...roleCategories]),
  );

  // Capability is required by AgentMatchCandidate.
  // Manifest schema has both `capability` (legacy) and `capabilities` (newer);
  // merge both plus all child-role capabilities.
  const childCaps = (manifest.roles ?? []).flatMap((r) => r.capabilities ?? []);
  const capability = Array.from(
    new Set([
      ...(manifest.capability ?? []),
      ...(manifest.capabilities ?? []),
      ...childCaps,
    ]),
  );

  return {
    agentId: manifest.agentId,
    name: manifest.name,
    role: manifest.role,
    capability,
    categories,
    roles: manifest.roles?.map((r) => ({
      id: r.id,
      name: r.name,
      capabilities: r.capabilities ?? [],
      category: r.category,
    })),
    x402: manifest.x402
      ? {
          enabled: Boolean(manifest.x402.enabled),
        }
      : undefined,
  };
}

/**
 * Pull every registered manifest and return matcher-ready candidates.
 * Used by /api/x402/jobs/[id]/route and /discovery.
 *
 * Failures (DB error / parse error) are logged and skipped — never throw,
 * because the routing endpoint must stay responsive even if a single
 * malformed manifest exists.
 */
export async function listRosterCandidates(): Promise<AgentMatchCandidate[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .select('agent_id, manifest, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[roster] list error', error.message);
    return [];
  }
  if (!data) return [];

  const out: AgentMatchCandidate[] = [];
  for (const row of data) {
    const parsed = parseManifest(row.manifest);
    if (!parsed.ok) {
      console.warn(`[roster] skip ${row.agent_id}: ${parsed.error}`);
      continue;
    }
    out.push(manifestToCandidate(parsed.manifest));
  }
  return out;
}

/**
 * Pull stored manifests (with hash + signature) for the discovery UI / SDK.
 * Same source as listRosterCandidates but returns the full StoredAgentManifest
 * so callers can show controller, signer, updated_at.
 */
export async function listStoredManifests(): Promise<StoredAgentManifest[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .select('agent_id, controller, manifest, manifest_hash, signature, signer, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[roster] list stored error', error.message);
    return [];
  }
  if (!data) return [];

  const out: StoredAgentManifest[] = [];
  for (const row of data) {
    const parsed = parseManifest(row.manifest);
    if (!parsed.ok) continue;
    out.push({
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
