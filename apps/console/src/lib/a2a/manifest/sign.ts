import { keccak256, stringToBytes } from 'viem';
import type { AgentManifestV1 } from './types';

/**
 * Canonical message format for signing manifest writes.
 * The signer must equal the on-chain controller for a registered agent,
 * or any address for first-claim (TOFU) on an unregistered agentId.
 *
 * Format:
 *   ArcLayer Manifest v1
 *   agentId=<id>
 *   hash=<0xkeccak of canonical JSON>
 *   ts=<unix-seconds>
 */
export function buildManifestMessage(input: { agentId: string; manifestHash: string; ts: number }): string {
  return [
    'ArcLayer Manifest v1',
    `agentId=${input.agentId}`,
    `hash=${input.manifestHash}`,
    `ts=${input.ts}`,
  ].join('\n');
}

/**
 * Canonicalize manifest JSON for hashing — sort keys, drop undefineds.
 * Anything signed must use this exact serialization.
 */
export function canonicalManifestJson(manifest: AgentManifestV1): string {
  return canonicalize(manifest);
}

export function manifestHash(manifest: AgentManifestV1): `0x${string}` {
  return keccak256(stringToBytes(canonicalManifestJson(manifest)));
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  return 'null';
}

/** Pointer URI we store on chain in metadataURI. */
export function manifestPointerURI(agentId: string): string {
  return `arclayer://manifest/${agentId}`;
}

export function isManifestPointerURI(uri: string): boolean {
  return uri.startsWith('arclayer://manifest/');
}

export function extractAgentIdFromPointer(uri: string): string | null {
  if (!isManifestPointerURI(uri)) return null;
  const id = uri.slice('arclayer://manifest/'.length).split('?')[0].trim();
  return id || null;
}
