#!/usr/bin/env node
/**
 * ERC-8183 Bot Env Preflight Checker
 *
 * Verifies each bot's .env has the required fields before starting PM2.
 * Supports Worker/Provider alias naming conventions.
 *
 * Usage:
 *   node scripts/check-env.mjs
 *   npm run check:env
 *
 * Exit codes:
 *   0 — all envs valid
 *   1 — one or more envs missing required fields
 *   2 — .env file not found
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOTS_DIR = resolve(__dirname, '..');

let allPass = true;
let exitCode = 0;

// ── Parsing helper — quotes-aware ──────────────────────────────────────────

function parseDotEnv(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// ── Check helpers ──────────────────────────────────────────────────────────

function getOr(value, ...alternatives) {
  return value || alternatives.find((a) => a);
}

function formatValue(key, value) {
  if (!value) return '<empty>';
  const sensitive = /PRIVATE_KEY|API_KEY|TOKEN|SECRET/i.test(key);
  if (sensitive) return '<set>';
  if (value.length > 24) return `${value.slice(0, 20)}...`;
  return value;
}

function checkRequired(env, botName, key, alternatives = []) {
  const found = key.startsWith('*')
    ? alternatives.some((alt) => env[alt])
    : Boolean(env[key]) || alternatives.some((alt) => env[alt]);

  if (found) {
    const usedKey = env[key]
      ? key
      : alternatives.find((alt) => env[alt]);
    if (alternatives.length > 0) {
      const displayKeys = [key, ...alternatives].join(' / ');
      console.log(`  ✓ ${displayKeys}: ${usedKey ? formatValue(usedKey, env[usedKey]) : 'set'}`);
    } else {
      console.log(`  ✓ ${key}: ${formatValue(key, env[key])}`);
    }
    return true;
  }

  console.log(`  ✗ MISSING: ${[key, ...alternatives].join(' / ')}`);
  allPass = false;
  exitCode = 1;
  return false;
}

function checkOptional(env, key, label) {
  if (env[key]) {
    console.log(`  ○ ${label || key}: ${formatValue(key, env[key])}`);
    return true;
  }
  console.log(`  - ${label || key}: (not set — optional)`);
  return false;
}

// ── Bot checks ─────────────────────────────────────────────────────────────

function checkBot(botName, requiredKeys) {
  const envPath = resolve(BOTS_DIR, botName, '.env');
  console.log(`\n── ${botName} ──────────────────────`);
  console.log(`File: ${envPath}`);

  if (!existsSync(envPath)) {
    console.log(`  ✗ .env not found`);
    console.log(`  → cp ${botName}/.env.example ${botName}/.env`);
    allPass = false;
    exitCode = 2;
    return;
  }

  const raw = readFileSync(envPath, 'utf8');
  const env = parseDotEnv(raw);

  for (const entry of requiredKeys) {
    if (typeof entry === 'string') {
      checkRequired(env, botName, entry);
    } else if (Array.isArray(entry)) {
      // [primary, ...alternatives]
      checkRequired(env, botName, entry[0], entry.slice(1));
    } else if (entry.or) {
      // { or: [primary, ...alternatives] }
      checkRequired(env, botName, entry.or[0], entry.or.slice(1));
    } else if (entry.key) {
      const { key: k, label, optional: opt } = entry;
      if (opt) {
        checkOptional(env, k, label);
      } else {
        checkRequired(env, botName, k, entry.alternatives || []);
      }
    }
  }

  // Print effective config
  console.log(`\n  Effective config:`);
  const agentId = env.PROVIDER_AGENT_ID || env.WORKER_AGENT_ID || '?';
  const addr = env.PROVIDER_ADDRESS || env.WORKER_ADDRESS || env.CLIENT_ADDRESS || env.EVALUATOR_ADDRESS || '?';
  console.log(`  Agent ID: ${agentId}`);
  console.log(`  Address:  ${addr?.slice(0, 12) + '...'}`);
}

// ── Run checks ─────────────────────────────────────────────────────────────

console.log('═ ERC-8183 Bot Env Preflight Check ═══════════════════');
console.log(`Bots root: ${BOTS_DIR}`);

const CHECKS = [
  {
    bot: 'client-bot',
    required: [
      'ARCLAYER_BASE_URL',
      'CLIENT_API_KEY',
      'ARCLAYER_AGENT_ID',
      'BUYER_AGENT_ID',
      'CLIENT_ADDRESS',
      'CLIENT_PRIVATE_KEY',
      ['PROVIDER_AGENT_ID', 'WORKER_AGENT_ID'],
      ['PROVIDER_ADDRESS', 'WORKER_ADDRESS'],
      'EVALUATOR_AGENT_ID',
      'EVALUATOR_ADDRESS',
      'ARC_RPC_URL',
    ],
  },
  {
    bot: 'provider-bot',
    required: [
      'ARCLAYER_BASE_URL',
      'WORKER_API_KEY',
      'ARCLAYER_AGENT_ID',
      ['PROVIDER_AGENT_ID', 'WORKER_AGENT_ID'],
      { key: 'WORKER_ID', optional: false },
      ['PROVIDER_ADDRESS', 'WORKER_ADDRESS'],
      ['PROVIDER_PRIVATE_KEY', 'WORKER_PRIVATE_KEY'],
      'ARC_RPC_URL',
    ],
  },
  {
    bot: 'evaluator-bot',
    required: [
      'ARCLAYER_BASE_URL',
      'EVALUATOR_API_KEY',
      'ARCLAYER_AGENT_ID',
      'EVALUATOR_AGENT_ID',
      'EVALUATOR_ADDRESS',
      'EVALUATOR_PRIVATE_KEY',
      'ARC_RPC_URL',
    ],
  },
];

for (const check of CHECKS) {
  checkBot(check.bot, check.required);
}

console.log(`\n═══════════════════════════════════════════════════════`);
if (exitCode === 0) {
  console.log('✅ All env checks passed — bots ready to start.');
} else if (exitCode === 2) {
  console.log(`❌ Missing .env files. Run cp .env.example .env in each bot dir first.`);
} else {
  console.log(`❌ Some required env vars are missing. Check ✗ entries above.`);
}
console.log(`\nTip: After fixing, run:  pm2 start client-bot/ecosystem.config.cjs`);
console.log(`                         pm2 start provider-bot/ecosystem.config.cjs`);
console.log(`                         pm2 start evaluator-bot/ecosystem.config.cjs`);

process.exit(exitCode);
