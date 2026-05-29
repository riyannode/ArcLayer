import { createApiKey } from '../src/lib/a2a/auth';

const createdBy = process.argv[2] || 'admin';

const agents = [
  {
    role: 'oracle',
    agentId: 'hermes-oracle',
    label: 'Commerce Oracle',
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
  {
    role: 'analyzer',
    agentId: 'apollo-analyzer',
    label: 'Commerce Analyzer',
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
  {
    role: 'evaluator',
    agentId: 'ignia-evaluator',
    label: 'Commerce Evaluator',
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
  {
    role: 'executor',
    agentId: 'budu-executor',
    label: 'Commerce Executor',
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
];

console.log('');
console.log('Creating Commerce Bot API keys with x402 scopes');
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
