/**
 * ERC-8004 agent identity helpers.
 *
 * Agent ID is minted on-chain from Transfer(from=0x0, to=owner, tokenId)
 * after register(metadataURI). Name is metadata only and never tokenId input.
 */

export function normalizeAgentName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildAgentMetadataURI(name: string, skillLabel: string): string {
  const norm = normalizeAgentName(name);
  const skill = skillLabel.trim().toLowerCase();
  const params = skill ? `?skill=${encodeURIComponent(skill)}` : '';
  return `arclayer://agent/${encodeURIComponent(norm)}${params}`;
}

export function parseAgentName(metadataURI: string | null | undefined): string | null {
  if (!metadataURI) return null;
  const m = /^arclayer:\/\/agent\/([^?#]+)/i.exec(metadataURI);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

export function parseAgentSkill(metadataURI: string | null | undefined): string | null {
  if (!metadataURI) return null;
  const m = /^arclayer:\/\/agent\/[^?#]+\?(.+)$/i.exec(metadataURI);
  if (!m) return null;
  const params = new URLSearchParams(m[1]);
  const skill = params.get('skill');
  return skill ? decodeURIComponent(skill) : null;
}

export function formatSkillLabel(skill: string | null | undefined): string | null {
  if (!skill) return null;
  return skill.split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function tryParseBigInt(value: bigint | string | number | null | undefined): bigint | null {
  try {
    if (typeof value === 'bigint') return value;

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
      return BigInt(value);
    }

    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return null;

      if (/^0x[0-9a-fA-F]+$/.test(text)) return BigInt(text);
      if (/^\d+$/.test(text)) return BigInt(text);
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

export function hasValidAgentId(id: bigint | string | number | null | undefined): boolean {
  return tryParseBigInt(id) !== null;
}

export function shortAgentId(id: bigint | string | number | null | undefined): string {
  const n = tryParseBigInt(id);
  if (n === null) return '#unknown';
  const hex = n.toString(16).padStart(64, '0');
  return `#${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

export function displayAgentLabel(opts: { agentId: bigint | string | number | null | undefined; metadataURI?: string | null }): string {
  const name = parseAgentName(opts.metadataURI ?? null);
  return name || shortAgentId(opts.agentId);
}
