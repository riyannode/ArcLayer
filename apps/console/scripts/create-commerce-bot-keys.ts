/**
 * Create Commerce Bot API keys.
 *
 * Agent IDs are configurable via env vars or CLI args.
 * Usage:
 *   npx tsx scripts/create-commerce-bot-keys.ts [createdBy] [oracleId] [analyzerId] [evaluatorId] [executorId]
 *
 * Or via env:
 *   AGENT_ID_ORACLE=my-oracle AGENT_ID_ANALYZER=my-analyzer npx tsx scripts/create-commerce-bot-keys.ts
 */

import { createApiKey } from '../src/lib/a2a/auth';

const createdBy = process.argv[2] || 'admin';

// Agent IDs: CLI args > env vars > generic defaults
const oracleId    = process.argv[3] || process.env.AGENT_ID_ORACLE    || 'commerce-oracle-01';
const analyzerId  = process.argv[4] || process.env.AGENT_ID_ANALYZER  || 'commerce-analyzer-01';
const evaluatorId = process.argv[5] || process.env.AGENT_ID_EVALUATOR || 'commerce-evaluator-01';
const executorId  = process.argv[6] || process.env.AGENT_ID_EXECUTOR  || 'commerce-executor-01';

const agents = [
  {
    role: 'oracle',
    agentId: oracleId,
    label: `${oracleId} (Commerce Oracle)`,
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
  {
    role: 'analyzer',
    agentId: analyzerId,
    label: `${analyzerId} (Commerce Analyzer)`,
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
  {
    role: 'evaluator',
    agentId: evaluatorId,
    label: `${evaluatorId} (Commerce Evaluator)`,
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
  {
    role: 'executor',
    agentId: executorId,
    label: `${executorId} (Commerce Executor)`,
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
];

console.log('');
console.log('Creating Commerce Bot API keys with x402 scopes');
console.log('createdBy:', createdBy);
console.log('agents:', agents.map(a => a.agentId).join(', '));

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
