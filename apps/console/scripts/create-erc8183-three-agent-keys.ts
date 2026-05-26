import { createApiKey } from '../src/lib/a2a/auth';

const createdBy = process.argv[2] || 'admin';

const clientAgentId = process.env.CLIENT_AGENT_ID || 'erc8183-client-001';
const providerAgentId = process.env.PROVIDER_AGENT_ID || 'erc8183-provider-001';
const evaluatorAgentId = process.env.EVALUATOR_AGENT_ID || 'erc8183-evaluator-001';

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
