export const AGENT_MANIFEST_SCHEMA = 'arclayer.agent/v1' as const;

export type AgentManifestV1 = {
  schema: typeof AGENT_MANIFEST_SCHEMA;
  version: 1;
  agentId: string;
  name: string;
  role: string;
  description: string;
  controller?: string;
  endpoint?: string;
  mode?: 'seller' | 'buyer' | 'dual';
  price?: string;
  capability: string[];
  categories: string[];
  tags?: string[];
  links?: {
    docs?: string;
    homepage?: string;
    repo?: string;
  };
  x402?: {
    enabled: boolean;
    payTo?: string;
    network?: string;
    currency?: string;
    price?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type ManifestParseSuccess = {
  ok: true;
  manifest: AgentManifestV1;
};

export type ManifestParseFailure = {
  ok: false;
  error: string;
};

export type ManifestParseResult = ManifestParseSuccess | ManifestParseFailure;

export type StoredAgentManifest = {
  agentId: string;
  controller: string | null;
  manifest: AgentManifestV1;
  manifestHash: string;
  signature: string | null;
  signer: string | null;
  updatedAt: string;
};
