/**
 * Pure scope-gating filter builders for ArcLayer/arcnetwork visibility.
 *
 * These are testable without Supabase or server-only imports.
 * Used by goldsky-supabase-indexer.ts and reusable by future readers.
 *
 * @module apps/console/src/lib/goldsky-scope-filters
 */

import {
  type IndexedJobEvent,
  type IndexedAgentEvent,
  isImportedArcLayerAgent,
  sourceForAgentEvent,
  matchesMetadataPrefix,
} from "@arclayer/sdk";

// ── Wallet matching ────────────────────────────────────────────────────────

/** Check if a wallet address is in the allowed set. Case-insensitive. */
export function isWalletAllowed(addr: unknown, allowed: Set<string>): boolean {
  if (typeof addr !== "string") return false;
  return allowed.has(addr.toLowerCase());
}

// ── Agent ID matching ──────────────────────────────────────────────────────

/** Agent ID candidate variants for matching (raw, full, source-prefixed). */
export function agentIdCandidates(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const id = String(value).trim().toLowerCase();
  if (!id) return [];
  const raw = id.includes(":") ? id.split(":").pop() || id : id;
  return Array.from(new Set([raw, id, `erc8004_identity_registry:${raw}`, `imported_arclayer_registry:${raw}`]));
}

/** Check if an agentId matches the allowed agent ID set. */
export function isAgentIdAllowed(agentId: unknown, allowed: Set<string>): boolean {
  if (allowed.size === 0) return false;
  const candidates = agentIdCandidates(agentId);
  return candidates.some((id) => allowed.has(id));
}

// ── Job filter builder ─────────────────────────────────────────────────────

/**
 * Build a job filter for arclayer scope.
 *
 * A job is visible if client, provider, or evaluator is in the allowed wallet set.
 * If the wallet set is empty (no env + no dynamic), NO jobs pass — empty allowlists
 * do NOT leak all data.
 *
 * For arcnetwork scope, pass `undefined` as the filter to sdkProjectJobs instead.
 */
export function buildJobFilter(
  allowed: Set<string>,
): (created: IndexedJobEvent | undefined) => boolean {
  return (created) =>
    isWalletAllowed(created?.client, allowed) ||
    isWalletAllowed(created?.provider, allowed) ||
    isWalletAllowed(created?.evaluator, allowed);
}

// ── Agent filter builder ───────────────────────────────────────────────────

/**
 * Build an agent filter for arclayer scope.
 *
 * An agent is visible if ANY of:
 * - source is "imported_arclayer_registry" (always passes)
 * - controller wallet is in the allowed wallet set
 * - controller appears in retained ArcLayer job wallets
 * - agentId matches the agent ID allowlist
 * - metadata URI matches one of the allowed prefixes
 *
 * If allowlists are empty and no metadata match, only imported agents pass.
 *
 * For arcnetwork scope, pass `undefined` as the filter to sdkProjectAgents instead.
 */
export function buildAgentFilter(
  allowedWallets: Set<string>,
  allowedAgentIds: Set<string>,
  arcJobWallets: Set<string>,
): (event: IndexedAgentEvent) => boolean {
  return (event) => {
    if (isImportedArcLayerAgent(event)) return true;

    const ctrl = (event.controller ?? "").toLowerCase();
    const uri = event.metadataURI ?? "";
    const rawAgentId = String(event.agentId);
    const source = sourceForAgentEvent(event);
    const sourceAgentId = `${source}:${rawAgentId}`;

    if (isWalletAllowed(ctrl, allowedWallets)) return true;
    if (arcJobWallets.has(ctrl)) return true;
    if (isAgentIdAllowed(rawAgentId, allowedAgentIds)) return true;
    if (isAgentIdAllowed(sourceAgentId, allowedAgentIds)) return true;
    if (matchesMetadataPrefix(uri, METADATA_PREFIX_FILTER)) return true;
    return false;
  };
}

// Default metadata prefixes (must match goldsky-supabase-indexer.ts)
const METADATA_PREFIX_FILTER: string[] = (
  process.env.ARC_REFERENCE_METADATA_PREFIX_FILTER ||
  "arclayer://,https://arclayers.xyz"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
