import { AGENT_MANIFEST_SCHEMA, type AgentManifestV1, type ManifestParseResult } from './types';

const MAX_STRING = 2000;
const MAX_ARRAY = 12;

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isStringArray(v: unknown, max = MAX_ARRAY): v is string[] {
  return Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'string' && x.length <= 200);
}

export function parseManifest(raw: unknown): ManifestParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Manifest must be a JSON object.' };
  }

  const m = raw as Record<string, unknown>;

  if (m.schema !== AGENT_MANIFEST_SCHEMA) {
    return { ok: false, error: `Invalid schema. Expected "${AGENT_MANIFEST_SCHEMA}".` };
  }
  if (m.version !== 1) {
    return { ok: false, error: 'Unsupported manifest version.' };
  }
  if (!isString(m.agentId) || !m.agentId.trim()) {
    return { ok: false, error: 'agentId is required.' };
  }
  if (!isString(m.name) || !m.name.trim() || m.name.length > 120) {
    return { ok: false, error: 'name is required (max 120 chars).' };
  }
  if (!isString(m.role) || !m.role.trim() || m.role.length > 200) {
    return { ok: false, error: 'role is required (max 200 chars).' };
  }
  if (!isString(m.description) || !m.description.trim() || m.description.length > MAX_STRING) {
    return { ok: false, error: `description is required (max ${MAX_STRING} chars).` };
  }
  if (!isStringArray(m.capability)) {
    return { ok: false, error: 'capability must be a string array (max 12 items).' };
  }
  if (!isStringArray(m.categories)) {
    return { ok: false, error: 'categories must be a string array (max 12 items).' };
  }

  // Optional fields — validate if present
  if (m.controller !== undefined && (!isString(m.controller) || !/^0x[a-fA-F0-9]{40}$/.test(m.controller))) {
    return { ok: false, error: 'controller must be a valid Ethereum address.' };
  }
  if (m.endpoint !== undefined && (!isString(m.endpoint) || !/^https?:\/\//.test(m.endpoint))) {
    return { ok: false, error: 'endpoint must be a valid HTTPS URL.' };
  }
  if (m.mode !== undefined && !['seller', 'buyer', 'dual'].includes(m.mode as string)) {
    return { ok: false, error: 'mode must be seller, buyer, or dual.' };
  }
  if (m.price !== undefined && (!isString(m.price) || m.price.length > 100)) {
    return { ok: false, error: 'price must be a string (max 100 chars).' };
  }
  if (m.avatar !== undefined && m.avatar !== '' && (!isString(m.avatar) || !/^https?:\/\//.test(m.avatar) || m.avatar.length > 1000)) {
    return { ok: false, error: 'avatar must be a valid http(s) URL (max 1000 chars).' };
  }
  if (m.tags !== undefined && !isStringArray(m.tags)) {
    return { ok: false, error: 'tags must be a string array (max 12 items).' };
  }

  // Validate links object
  if (m.links !== undefined) {
    if (typeof m.links !== 'object' || m.links === null) {
      return { ok: false, error: 'links must be an object.' };
    }
    const links = m.links as Record<string, unknown>;
    for (const key of ['docs', 'homepage', 'repo']) {
      if (links[key] !== undefined && (!isString(links[key]) || (links[key] as string).length > 500)) {
        return { ok: false, error: `links.${key} must be a string (max 500 chars).` };
      }
    }
  }

  // Validate x402 object
  if (m.x402 !== undefined) {
    if (typeof m.x402 !== 'object' || m.x402 === null) {
      return { ok: false, error: 'x402 must be an object.' };
    }
    const x = m.x402 as Record<string, unknown>;
    if (typeof x.enabled !== 'boolean') {
      return { ok: false, error: 'x402.enabled must be a boolean.' };
    }
  }

  // Validate timestamps
  if (!isString(m.createdAt)) {
    return { ok: false, error: 'createdAt is required (ISO string).' };
  }
  if (!isString(m.updatedAt)) {
    return { ok: false, error: 'updatedAt is required (ISO string).' };
  }

  const manifest: AgentManifestV1 = {
    schema: AGENT_MANIFEST_SCHEMA,
    version: 1,
    agentId: (m.agentId as string).trim(),
    name: (m.name as string).trim(),
    role: (m.role as string).trim(),
    description: (m.description as string).trim(),
    capability: m.capability as string[],
    categories: m.categories as string[],
    createdAt: m.createdAt as string,
    updatedAt: m.updatedAt as string,
  };

  // Attach optionals
  if (m.controller) manifest.controller = m.controller as string;
  if (m.endpoint) manifest.endpoint = m.endpoint as string;
  if (m.mode) manifest.mode = m.mode as AgentManifestV1['mode'];
  if (m.price) manifest.price = m.price as string;
  if (m.avatar && typeof m.avatar === 'string' && m.avatar.trim()) manifest.avatar = m.avatar.trim();
  if (m.tags) manifest.tags = m.tags as string[];
  if (m.links) manifest.links = m.links as AgentManifestV1['links'];
  if (m.x402) manifest.x402 = m.x402 as AgentManifestV1['x402'];

  return { ok: true, manifest };
}
