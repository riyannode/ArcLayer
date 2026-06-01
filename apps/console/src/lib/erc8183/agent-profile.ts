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
 * Protocol-level markers that identify an agent as ERC-8183 commerce.
 * These are NOT generic skill/job tags — they are protocol signals.
 */
export const ERC8183_AGENT_MARKERS = [
  'erc8183',
  'erc8183-commerce',
  'job-commerce',
  'job-creation',
  'a2a_job',
  'escrow',
  'claim_job',
  'submit_result',
  'approve_result',
  'settle_job',
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

  return ERC8183_AGENT_MARKERS.some((marker) =>
    normalized.some((value) => value.includes(marker)),
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
