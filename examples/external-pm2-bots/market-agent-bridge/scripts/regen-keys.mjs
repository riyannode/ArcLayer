/**
 * Regenerate API keys for all prediction market bots.
 *
 * Usage:
 *   1. Set private keys as env vars (never commit them):
 *      export ORACLE_PK=0x...
 *      export ANALYZER_PK=0x...
 *      export EVALUATOR_PK=0x...
 *      export EXECUTOR_PK=0x...
 *
 *   2. Run:
 *      node scripts/regen-keys.mjs
 *
 *   3. Copy output keys to .env.<role> files on your VPS.
 *
 * Required scopes per role:
 *   oracle/analyzer/evaluator: agent_bridge:write, agent_bridge:receipt, live_events:write, presence:write
 *   executor (extra):          x402:pay
 */

import { privateKeyToAccount } from 'viem/accounts';

const BASE_URL = process.env.ARCLAYER_BASE_URL || 'https://arclayers.xyz';

const bots = [
  {
    role: 'oracle',
    agentId: process.env.ORACLE_AGENT_ID,
    pk: process.env.ORACLE_PK,
    scopes: ['agent_bridge:write', 'agent_bridge:receipt', 'live_events:write', 'presence:write'],
  },
  {
    role: 'analyzer',
    agentId: process.env.ANALYZER_AGENT_ID,
    pk: process.env.ANALYZER_PK,
    scopes: ['agent_bridge:write', 'agent_bridge:receipt', 'live_events:write', 'presence:write'],
  },
  {
    role: 'evaluator',
    agentId: process.env.EVALUATOR_AGENT_ID,
    pk: process.env.EVALUATOR_PK,
    scopes: ['agent_bridge:write', 'agent_bridge:receipt', 'live_events:write', 'presence:write'],
  },
  {
    role: 'executor',
    agentId: process.env.EXECUTOR_AGENT_ID,
    pk: process.env.EXECUTOR_PK,
    scopes: ['agent_bridge:write', 'agent_bridge:receipt', 'live_events:write', 'presence:write', 'x402:pay'],
  },
];

function keyMessage({ agentId, action, ts }) {
  return [
    'ArcLayer A2A API Key',
    `action: ${action}`,
    `agentId: ${agentId}`,
    `ts: ${ts}`,
  ].join('\n');
}

async function main() {
  const results = [];

  for (const bot of bots) {
    if (!bot.pk) {
      console.error(`[${bot.role}] SKIPPED — set ${bot.role.toUpperCase()}_PK env var`);
      results.push({ role: bot.role, ok: false, error: 'missing_private_key' });
      continue;
    }
    if (!bot.agentId) {
      console.error(`[${bot.role}] SKIPPED — set ${bot.role.toUpperCase()}_AGENT_ID env var`);
      results.push({ role: bot.role, ok: false, error: 'missing_agent_id' });
      continue;
    }

    const account = privateKeyToAccount(bot.pk);
    const ts = Math.floor(Date.now() / 1000);
    const message = keyMessage({ agentId: bot.agentId, action: 'create', ts });
    const signature = await account.signMessage({ message });

    console.log(`[${bot.role}] wallet=${account.address} agentId=${bot.agentId}`);

    const res = await fetch(`${BASE_URL}/api/a2a/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        agentId: bot.agentId,
        label: `${bot.role}-bot-${Date.now()}`,
        scopes: bot.scopes,
        ts,
        signature,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error(`[${bot.role}] FAILED:`, JSON.stringify(data));
      results.push({ role: bot.role, ok: false, error: data.error });
      continue;
    }

    console.log(`[${bot.role}] OK prefix=${data.keyPrefix}`);
    results.push({ role: bot.role, ok: true, key: data.key, keyPrefix: data.keyPrefix, id: data.id });
  }

  console.log('\n=== GENERATED KEYS (copy to .env.<role> files) ===\n');
  for (const r of results) {
    if (r.ok) {
      console.log(`# .env.${r.role}`);
      console.log(`ARCLAYER_API_KEY=${r.key}\n`);
    } else {
      console.log(`# .env.${r.role}: FAILED — ${r.error}\n`);
    }
  }

  console.log('=== PREDICTION_AGENT_KEYS (for heartbeat) ===\n');
  const okBots = results.filter((r) => r.ok);
  if (okBots.length) {
    console.log(okBots.map((r) => `${bots.find((b) => b.role === r.role)?.agentId}:${r.key}`).join(','));
  }
}

main().catch(console.error);
