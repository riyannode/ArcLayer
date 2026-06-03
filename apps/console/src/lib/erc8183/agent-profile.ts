export type Erc8183AgentMetadata = {
  schema?: string;
  standard?: string;
  dashboard?: string;
  name?: string;
  role?: string;
  category?: string;
  description?: string;
  avatar?: string;
  image?: string;
  logo?: string;
  capability?: string[];
  capabilities?: string[];
  categories?: string[];
  tags?: string[];
  metadataURI?: string;
  txHash?: string;
  links?: {
    homepage?: string;
    website?: string;
    docs?: string;
    repo?: string;
    x?: string;
    twitter?: string;
  };
};

/**
 * Explicit ERC-8183 protocol markers — metadata fields that declare ERC-8183 compliance.
 * These are protocol-level signals, NOT job capability tags.
 */
export const ERC8183_AGENT_MARKERS = [
  'erc8183',
  'erc8183-commerce',
  'job-commerce',
  'agentic-commerce',
] as const;

/**
 * Job capability markers — lifecycle actions an ERC-8183 agent supports.
 * a2a_job is valid ONLY when paired with an explicit ERC-8183 marker above.
 */
export const ERC8183_JOB_CAPABILITIES = [
  'claim_job',
  'submit_work',
  'submit_result',
  'approve_result',
  'settle_job',
  'job-creation',
  'escrow',
  'a2a_job',
] as const;

function asArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function ipfsToHttp(uri: string) {
  if (!uri.startsWith('ipfs://')) return uri;
  return `https://ipfs.io/ipfs/${uri.replace('ipfs://', '')}`;
}

export function getAgentProfileValues(metadata?: Erc8183AgentMetadata | null) {
  if (!metadata) return [];

  return [
    metadata.schema,
    metadata.standard,
    metadata.dashboard,
    metadata.role,
    metadata.category,
    ...asArray(metadata.tags),
    ...asArray(metadata.categories),
    ...asArray(metadata.capability),
    ...asArray(metadata.capabilities),
  ]
    .filter(Boolean)
    .map(normalize);
}

export function isErc8183ProfileMetadata(metadata?: Erc8183AgentMetadata | null) {
  const values = getAgentProfileValues(metadata);

  if (normalize(metadata?.standard) === 'erc8183') return true;
  if (normalize(metadata?.dashboard) === 'erc8183') return true;

  return ERC8183_AGENT_MARKERS.some((marker) =>
    values.some((value) => value.includes(marker)),
  );
}

export function isErc8183CapabilityList(values: string[]) {
  const normalized = values.map(normalize);

  return ERC8183_JOB_CAPABILITIES.some((cap) =>
    normalized.some((value) => value.includes(cap)),
  );
}

export function getErc8183Capabilities(metadata?: Erc8183AgentMetadata | null) {
  if (!metadata) return [];

  return Array.from(
    new Set(
      [
        ...asArray(metadata.capabilities),
        ...asArray(metadata.capability),
        ...asArray(metadata.tags),
      ]
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function getErc8183Links(metadata?: Erc8183AgentMetadata | null) {
  const links = metadata?.links || {};

  return {
    website: links.homepage || links.website || '',
    docs: links.docs || '',
    repo: links.repo || '',
    x: links.x || links.twitter || '',
  };
}

export function getErc8183Avatar(metadata?: Erc8183AgentMetadata | null) {
  return metadata?.avatar || metadata?.image || metadata?.logo || '';
}

export async function fetchErc8183Metadata(metadataURI?: string) {
  if (!metadataURI) return null;

  // Support data:application/json URIs (inline metadata)
  if (metadataURI.startsWith('data:application/json,')) {
    try {
      const encoded = metadataURI.slice('data:application/json,'.length);
      const json = JSON.parse(decodeURIComponent(encoded)) as Erc8183AgentMetadata;
      return { ...json, metadataURI };
    } catch {
      return null;
    }
  }
  if (metadataURI.startsWith('data:application/json;base64,')) {
    try {
      const b64 = metadataURI.slice('data:application/json;base64,'.length);
      let jsonStr: string;
      if (typeof atob !== 'undefined') {
        // Browser: atob returns Latin-1 bytes, decode as UTF-8 via TextDecoder
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        jsonStr = new TextDecoder('utf-8').decode(bytes);
      } else {
        jsonStr = Buffer.from(b64, 'base64').toString('utf8');
      }
      const json = JSON.parse(jsonStr) as Erc8183AgentMetadata;
      return { ...json, metadataURI };
    } catch {
      return null;
    }
  }

  const uri = ipfsToHttp(metadataURI);

  if (!uri.startsWith('https://') && !uri.startsWith('http://')) {
    return null;
  }

  try {
    const res = await fetch(uri, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });

    if (!res.ok) return null;

    const json = (await res.json()) as Erc8183AgentMetadata;

    return {
      ...json,
      metadataURI,
    };
  } catch {
    return null;
  }
}

export function shortText(value?: string, head = 6, tail = 4) {
  if (!value) return '—';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function roleLabel(value?: string) {
  if (!value) return 'Worker';
  if (value === 'provider') return 'Worker';
  if (value === 'autonomous-client') return 'Client';

  return value
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

export function displayCategory(metadata?: Erc8183AgentMetadata | null) {
  if (metadata?.category) return metadata.category;

  const categories = Array.isArray(metadata?.categories)
    ? metadata.categories
    : [];

  const visible = categories.find((item) => {
    const normalized = normalize(item);
    return (
      normalized !== 'arclayer' &&
      normalized !== 'erc8183' &&
      normalized !== 'erc8183-commerce' &&
      normalized !== 'agentic-commerce' &&
      normalized !== 'job-commerce'
    );
  });

  return visible || 'ERC-8183 Commerce';
}
