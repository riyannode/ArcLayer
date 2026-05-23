// Bootstrap: register Pythia + Hermes + Resolver agents on A2AAgentRegistry
// Run once after deploy. Saves agentIds to agents/contracts/agent-ids.json.
import 'dotenv/config';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount } from 'viem/accounts';
import { AgentRole, registerAgent, getAgentsByOwner, getAgent } from './a2a-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const AGENT_IDS_PATH = join(__dirname, 'agent-ids.json');

interface AgentIds {
  pythia?: { agentId: string; txHash: string; address: string };
  hermes?: { agentId: string; txHash: string; address: string };
  resolver?: { agentId: string; txHash: string; address: string };
}

async function loadOrInit(): Promise<AgentIds> {
  if (existsSync(AGENT_IDS_PATH)) {
    return JSON.parse(readFileSync(AGENT_IDS_PATH, 'utf8')) as AgentIds;
  }
  return {};
}

async function ensureAgent(
  pk: `0x${string}`,
  role: AgentRole,
  endpoint: string,
  metadataURI: string,
  label: keyof AgentIds,
  state: AgentIds,
) {
  const account = privateKeyToAccount(pk);
  const owner = account.address;

  // Skip if already in state file
  if (state[label]?.agentId) {
    console.log(`[${label}] already registered: ${state[label]?.agentId}`);
    return;
  }

  // Check on-chain by owner — skip if found
  const existing = await getAgentsByOwner(owner);
  if (existing.length > 0) {
    for (const id of existing) {
      const a = (await getAgent(id)) as { role: number; endpoint: string };
      if (Number(a.role) === Number(role)) {
        console.log(`[${label}] found existing on-chain: ${id}`);
        state[label] = { agentId: id, txHash: 'pre-existing', address: owner };
        return;
      }
    }
  }

  console.log(`[${label}] registering as role=${AgentRole[role]} endpoint=${endpoint}...`);
  const { txHash, agentId } = await registerAgent(pk, role, endpoint, metadataURI);
  if (!agentId) throw new Error(`[${label}] failed to extract agentId from tx ${txHash}`);
  state[label] = { agentId, txHash, address: owner };
  console.log(`[${label}] registered agentId=${agentId} tx=${txHash}`);
}

async function main() {
  const state = await loadOrInit();

  const pythiaPk = process.env.PYTHIA_ORACLE_PRIVATE_KEY as `0x${string}` | undefined;
  const hermesPk = process.env.HERMES_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pythiaPk) throw new Error('PYTHIA_ORACLE_PRIVATE_KEY missing');
  if (!hermesPk) throw new Error('HERMES_PRIVATE_KEY missing');

  const facilitator = process.env.FACILITATOR_URL ?? 'https://arclayers.xyz';
  const pythiaUrl = process.env.PYTHIA_URL ?? 'http://localhost:4001';

  await ensureAgent(
    pythiaPk,
    AgentRole.MARKET_DATA,
    `${pythiaUrl}/api/a2a/market-signal`,
    'ipfs://bafy/pythia.json',
    'pythia',
    state,
  );

  await ensureAgent(
    hermesPk,
    AgentRole.TRADER,
    `${facilitator}/api/agents/hermes`,
    'ipfs://bafy/hermes.json',
    'hermes',
    state,
  );

  // Resolver = Pythia oracle role (same key, different agent)
  await ensureAgent(
    pythiaPk,
    AgentRole.ORACLE,
    `${pythiaUrl}/api/a2a/resolver`,
    'ipfs://bafy/pythia-resolver.json',
    'resolver',
    state,
  );

  writeFileSync(AGENT_IDS_PATH, JSON.stringify(state, null, 2));
  console.log('\n✓ All agents registered. Saved to', AGENT_IDS_PATH);
  console.log(JSON.stringify(state, null, 2));
}

main().catch((err) => {
  console.error('bootstrap failed:', err);
  process.exit(1);
});
