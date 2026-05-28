import { createApiKey } from '../src/lib/a2a/auth';

const createdBy = process.argv[2] || 'admin';

function allowExampleAgents() {
  return process.env.ALLOW_EXAMPLE_AGENTS === 'true';
}

function exampleAgentId(role: 'client' | 'provider' | 'evaluator') {
  return ['erc8183', role, '001'].join('-');
}

function agentIdFromEnv(name: string, role: 'client' | 'provider' | 'evaluator') {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (allowExampleAgents()) return exampleAgentId(role);
  throw new Error(`Missing ${name}. Set it explicitly, or set ALLOW_EXAMPLE_AGENTS=true to use example agent IDs.`);
}

const clientAgentId = agentIdFromEnv('CLIENT_AGENT_ID', 'client');
const providerAgentId = agentIdFromEnv('PROVIDER_AGENT_ID', 'provider');
const evaluatorAgentId = agentIdFromEnv('EVALUATOR_AGENT_ID', 'evaluator');

const agents = [
  {
    role: 'client',
    agentId: clientAgentId,
    label: 'ERC-8183 Client / Buyer',
    scopes: ['erc8183:create', 'erc8183:confirm', 'erc8183:tx'],
  },
  {
    role: 'provider',
    agentId: providerAgentId,
    label: 'ERC-8183 Provider / Worker',
    scopes: ['erc8183:claim', 'erc8183:running', 'erc8183:submit', 'erc8183:tx'],
  },
  {
    role: 'evaluator',
    agentId: evaluatorAgentId,
    label: 'ERC-8183 Evaluator',
    scopes: ['erc8183:complete', 'erc8183:tx'],
  },
];

console.log('');
console.log('Creating ERC-8183 role API keys');
console.log('createdBy:', createdBy);

async function main() {
  for (const agent of agents) {
    const result = await createApiKey({
      agentId: agent.agentId,
      label: agent.label,
      scopes: agent.scopes,
      createdBy,
    });

    if (!result.ok) {
      console.error('');
      console.error(`FAILED: ${agent.agentId}`);
      console.error(result.error);
      process.exit(1);
    }

    console.log('');
    console.log(`=== ${agent.role.toUpperCase()} ===`);
    console.log(`AGENT_ID=${agent.agentId}`);
    console.log(`KEY_PREFIX=${result.keyPrefix}`);
    console.log(`SCOPES=${agent.scopes.join(',')}`);
    console.log('');
    console.log('RAW KEY - copy once only:');
    console.log(result.key);
  }
}
main().catch((err) => {
  console.error('\nKey generation failed:', err.message);
  process.exit(1);
});
