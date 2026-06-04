const { privateKeyToAccount } = require('viem/accounts');
const { recoverMessageAddress } = require('viem');

const BASE_URL = 'https://arclayers.xyz';

const bots = [
  {
    role: 'oracle',
    agentId: 'hermes-oracle',
    pk: '0x1326b0bdea3718c98be6920afbd9528c4b61c94e0caf8855222db196c27438ad',
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
  {
    role: 'analyzer',
    agentId: 'apollo-analyzer',
    pk: '0x245c61b877a9fd7fceb5a860bfc4c6d56a8e471e8a8e72e5be328f04515e5033',
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
  {
    role: 'evaluator',
    agentId: 'ignia-evaluator',
    pk: '0xac90fcc46c3e66b581d8d04f471eec2fb8e5e04a98fe762afc34c2dc67e06f8e',
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
  {
    role: 'executor',
    agentId: 'budu-executor',
    pk: '0x068a5a64bc08988058819a3a91a6f43965578a60fb393094932e2ebb351edbac',
    scopes: ['agent_bridge:write', 'agent_bridge:receipt'],
  },
];

function keyMessage(agentId, action, ts) {
  return `ArcLayer A2A API Key\naction: ${action}\nagentId: ${agentId}\nts: ${ts}`;
}

async function createKey(bot) {
  const account = privateKeyToAccount(bot.pk);
  const ts = Math.floor(Date.now() / 1000);
  const message = keyMessage(bot.agentId, 'create', ts);
  const signature = await account.signMessage({ message });

  // Verify signature
  const signer = await recoverMessageAddress({ message, signature });
  if (signer.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Signature mismatch for ${bot.role}`);
  }

  const res = await fetch(`${BASE_URL}/api/a2a/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: bot.agentId,
      label: `Commerce ${bot.role} (x402 stress test)`,
      scopes: bot.scopes,
      ts,
      signature,
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`${bot.role}: ${data.error} - ${JSON.stringify(data)}`);
  }

  return { role: bot.role, agentId: bot.agentId, key: data.key, keyPrefix: data.keyPrefix, id: data.id };
}

async function main() {
  console.log('Creating API keys with x402 scopes...\n');

  for (const bot of bots) {
    try {
      const result = await createKey(bot);
      console.log(`=== ${result.role.toUpperCase()} ===`);
      console.log(`AGENT_ID=${result.agentId}`);
      console.log(`KEY=${result.key}`);
      console.log(`KEY_PREFIX=${result.keyPrefix}`);
      console.log(`ID=${result.id}`);
      console.log('');
    } catch (err) {
      console.error(`FAILED ${bot.role}: ${err.message}\n`);
    }
  }
}

main().catch(console.error);
