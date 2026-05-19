/**
 * Agent name <-> on-chain agentId helpers.
 *
 * The AgentRegistry contract takes a `uint256 agentId`. Forcing humans to
 * pick a free number is bad UX (collisions, no semantics, easy to forget).
 * Instead we let users register by *name* and derive the on-chain id
 * deterministically from that name:
 *
 *     agentId = uint256(keccak256(lowercase(trim(name))))
 *
 * Same name -> same id. Different names -> different ids (collision
 * resistance is keccak's job; for human-chosen short strings this is
 * effectively perfect).
 *
 * The on-chain `metadataURI` field is reused to round-trip the name so the
 * frontend can render "pelong" instead of "#9f3c…7a21". We use the URL
 * scheme:
 *
 *     arclayer://agent/<name>?skill=<label>
 *
 * which keeps the canonical name on chain (no IPFS roundtrip needed) while
 * staying compatible with future richer metadata pinned at IPFS — callers
 * who want IPFS-pinned metadata can just override the field.
 *
 * Backward compatibility: the original demo registered numeric ids (1, 3).
 * `parseAgentName()` returns null for those, and the UI falls back to
 * `#1`, `#3` so legacy agents render fine.
 */

import { keccak256, stringToBytes } from 'viem';

/** Normalize a human name before hashing/storing. */
export function normalizeAgentName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Convert a human name to the deterministic uint256 agentId stored on chain.
 * Throws on empty input — caller is expected to gate the button.
 */
export function nameToAgentId(name: string): bigint {
  const norm = normalizeAgentName(name);
  if (!norm) throw new Error('Agent name is empty.');
  // keccak256 returns 0x-prefixed 32-byte hex — directly parseable as uint256.
  const hash = keccak256(stringToBytes(norm));
  return BigInt(hash);
}

/**
 * Build the canonical metadataURI we store on chain for name-registered
 * agents. Uses the `arclayer://agent/<name>?skill=<label>` URI scheme so the
 * value is a readable identifier and doesn't depend on a gateway.
 */
export function buildAgentMetadataURI(name: string, skillLabel: string): string {
  const norm = normalizeAgentName(name);
  const skill = skillLabel.trim().toLowerCase();
  const params = skill ? `?skill=${encodeURIComponent(skill)}` : '';
  return `arclayer://agent/${encodeURIComponent(norm)}${params}`;
}

/**
 * Inverse of `buildAgentMetadataURI`: extract the human name from a
 * metadataURI we control, or null if the URI doesn't follow our scheme
 * (legacy numeric agents, IPFS pins, etc.).
 */
export function parseAgentName(metadataURI: string | null | undefined): string | null {
  if (!metadataURI) return null;
  const m = /^arclayer:\/\/agent\/([^?#]+)/i.exec(metadataURI);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Extract the `?skill=` query value from our `arclayer://agent/<name>?skill=<label>`
 * metadata URI. Returns the raw skill string (e.g. "solidity-auditor") or null
 * if the URI doesn't follow our scheme.
 */
export function parseAgentSkill(metadataURI: string | null | undefined): string | null {
  if (!metadataURI) return null;
  const m = /^arclayer:\/\/agent\/[^?#]+\?(.+)$/i.exec(metadataURI);
  if (!m) return null;
  const params = new URLSearchParams(m[1]);
  const skill = params.get('skill');
  return skill ? decodeURIComponent(skill) : null;
}

/**
 * Pretty-print a skill label like "solidity-auditor" → "Solidity Auditor".
 */
export function formatSkillLabel(skill: string | null | undefined): string | null {
  if (!skill) return null;
  return skill
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Heuristic: numeric ids (1, 2, 3…) are legacy demo registrations. */
export function isLegacyNumericId(id: bigint | string | number): boolean {
  const n = typeof id === 'bigint' ? id : BigInt(id);
  // keccak-derived ids are effectively guaranteed to be > 2^200. Any id
  // smaller than 2^32 is almost certainly a hand-picked demo number.
  return n < BigInt(4_294_967_296);
}

/** Short visual id "#9f3c…7a21" for hash-based agentIds. */
export function shortAgentId(id: bigint | string | number): string {
  const n = typeof id === 'bigint' ? id : BigInt(id);
  if (isLegacyNumericId(n)) return `#${n.toString()}`;
  const hex = n.toString(16).padStart(64, '0');
  return `#${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

/**
 * Display label that prefers a human name and falls back to the short id.
 * Used by the agents list and individual agent detail page.
 */
export function displayAgentLabel(opts: {
  agentId: bigint | string | number;
  metadataURI?: string | null;
}): string {
  const name = parseAgentName(opts.metadataURI ?? null);
  if (name) return name;
  return shortAgentId(opts.agentId);
}
