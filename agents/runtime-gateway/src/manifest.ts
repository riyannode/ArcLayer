export type AgentManifestRole = {
  id: string;
  name: string;
  category: string;
  capabilities: string[];
  endpointPath?: string;
  price?: string;
  enabled?: boolean;
};

export type AgentManifestV1 = {
  schema: 'arclayer.agent/v1';
  version: 1;
  agentId: string;
  name: string;
  description: string;
  endpoint: string;
  controller?: string;
  role: string;
  capability: string[];
  capabilities?: string[];
  categories: string[];
  roles: AgentManifestRole[];
  x402?: {
    enabled: boolean;
    receiver?: string;
    network?: string;
    currency?: string;
    price?: string;
  };
  proof?: { types?: string[]; signing?: string };
  createdAt: string;
  updatedAt: string;
};

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function csv(value: string): string[] {
  return value.split(',').map((v) => v.trim()).filter(Boolean);
}

export function buildManifest(): AgentManifestV1 {
  const now = new Date().toISOString();
  const capabilities = csv(env('AGENT_CAPABILITIES', 'audit,code-review'));
  const category = env('AGENT_CATEGORY', 'security');
  const role = env('AGENT_ROLE', 'security-auditor');

  return {
    schema: 'arclayer.agent/v1',
    version: 1,
    agentId: env('AGENT_ID', 'openclaw-auditor'),
    name: env('AGENT_NAME', 'OpenClaw Auditor'),
    description: env('AGENT_DESCRIPTION', 'External ArcLayer-compatible runtime.'),
    endpoint: env('AGENT_ENDPOINT', 'http://localhost:8788'),
    controller: env('AGENT_WALLET'),
    role,
    capability: capabilities,
    capabilities,
    categories: [category],
    roles: [
      {
        id: role,
        name: role.replace(/-/g, ' ').replace(/\w/g, (c) => c.toUpperCase()),
        category,
        capabilities,
        endpointPath: '/jobs/run',
        price: env('X402_PRICE', '0.02 USDC/job'),
        enabled: true,
      },
    ],
    x402: {
      enabled: true,
      receiver: env('AGENT_WALLET'),
      network: 'arc-testnet',
      currency: 'USDC',
      price: env('X402_PRICE', '0.02 USDC/job'),
    },
    proof: { types: ['runtime-receipt'], signing: 'controller-wallet' },
    createdAt: now,
    updatedAt: now,
  };
}
