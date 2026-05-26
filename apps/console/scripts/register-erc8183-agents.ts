import { randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';

const BASE_URL = process.env.ARCLAYER_BASE_URL ?? 'https://www.arclayers.xyz';

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function optional(name: string, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

function normalizePrivateKey(value: string): `0x${string}` {
  return value.startsWith('0x') ? (value as `0x${string}`) : (`0x${value}` as `0x${string}`);
}

type AgentConfig = {
  agentId: string;
  name: string;
  endpoint: string;
  privateKeyEnv: string;
  capabilities: string[];
};

const agents: AgentConfig[] = [
  {
    agentId: optional('CLIENT_AGENT_ID', 'erc8183-client-001'),
    name: optional('CLIENT_AGENT_NAME', 'ERC-8183 Client Bot'),
    endpoint: optional('CLIENT_AGENT_ENDPOINT', 'https://client-bot.example.com'),
    privateKeyEnv: 'CLIENT_PRIVATE_KEY',
    capabilities: ['erc8183-client', 'create-job', 'fund-escrow'],
  },
  {
    agentId: optional('PROVIDER_AGENT_ID', 'erc8183-provider-001'),
    name: optional('PROVIDER_AGENT_NAME', 'ERC-8183 Provider Bot'),
    endpoint: optional('PROVIDER_AGENT_ENDPOINT', 'https://provider-bot.example.com'),
    privateKeyEnv: 'PROVIDER_PRIVATE_KEY',
    capabilities: ['erc8183-provider', 'claim-job', 'run-job', 'submit-deliverable'],
  },
  {
    agentId: optional('EVALUATOR_AGENT_ID', 'erc8183-evaluator-001'),
    name: optional('EVALUATOR_AGENT_NAME', 'ERC-8183 Evaluator Bot'),
    endpoint: optional('EVALUATOR_AGENT_ENDPOINT', 'https://evaluator-bot.example.com'),
    privateKeyEnv: 'EVALUATOR_PRIVATE_KEY',
    capabilities: ['erc8183-evaluator', 'evaluate-deliverable', 'complete-job'],
  },
];

function buildRegistrationMessage(input: {
  agentId: string;
  address: string;
  capabilities: string[];
  timestamp: string;
  requestId: string;
}) {
  return [
    'ArcLayer External Agent Registration',
    '',
    `Agent ID: ${input.agentId}`,
    `Address: ${input.address}`,
    `Capabilities: ${input.capabilities.join(',')}`,
    `Timestamp: ${input.timestamp}`,
    `Request ID: ${input.requestId}`,
    '',
    'This signature registers this wallet as the owner/controller of the external ArcLayer agent.',
  ].join('\n');
}

async function registerAgent(agent: AgentConfig) {
  const privateKey = normalizePrivateKey(required(agent.privateKeyEnv));
  const account = privateKeyToAccount(privateKey);

  const timestamp = new Date().toISOString();
  const requestId = randomUUID();

  const message = buildRegistrationMessage({
    agentId: agent.agentId,
    address: account.address,
    capabilities: agent.capabilities,
    timestamp,
    requestId,
  });

  const signature = await account.signMessage({ message });

  const res = await fetch(`${BASE_URL}/api/a2a/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      agentId: agent.agentId,
      address: account.address,
      name: agent.name,
      endpoint: agent.endpoint,
      capabilities: agent.capabilities,
      message,
      signature,
    }),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    console.error('');
    console.error(`FAILED: ${agent.agentId}`);
    console.error('status:', res.status);
    console.error(json);
    process.exitCode = 1;
    return;
  }
  console.log('');
  console.log(`REGISTERED: ${agent.agentId}`);
  console.log('name:', agent.name);
  console.log('address:', account.address);
  console.log('status:', json?.status);
  console.log('endpoint:', agent.endpoint);
  console.log('capabilities:', agent.capabilities.join(', '));
}

console.log('');
console.log('ArcLayer ERC-8183 agent registration');
console.log('Base URL:', BASE_URL);

async function main() {
  for (const agent of agents) {
    await registerAgent(agent);
  }
}
main().catch((err) => {
  console.error('\nRegistration failed:', err.message);
  process.exit(1);
});
