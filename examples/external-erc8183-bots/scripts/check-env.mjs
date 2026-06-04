#!/usr/bin/env node
/**
 * ERC-8183 Bot Env Preflight Checker
 *
 * Verifies each bot's .env has the required fields before starting PM2.
 * Strict mode: no ARCLAYER_API_KEY fallback, no WORKER_* env, no cross-role leaks.
 *
 * Usage:
 *   node scripts/check-env.mjs
 *   npm run check:env
 *
 * Exit codes:
 *   0 — all envs valid
 *   1 — one or more envs missing required fields
 *   2 — .env file not found
 *   3 — rejected env vars found
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

// ── Format value for logging (redact secrets) ──────────────────────────────

function formatValue(key, value) {
  if (!value) return '<empty>';
  const sensitive = /PRIVATE_KEY|API_KEY|TOKEN|SECRET/i.test(key);
  if (sensitive) return '<set>';
  if (value.length > 24) return `${value.slice(0, 20)}...`;
  return value;
}

// ── Check helpers ──────────────────────────────────────────────────────────

function checkRequired(env, botName, key) {
  if (env[key]) {
    console.log(`  ✓ ${key}: ${formatValue(key, env[key])}`);
    return true;
  }

  console.log(`  ✗ MISSING: ${key}`);
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

// ── Reject helpers ─────────────────────────────────────────────────────────

/**
 * Reject specific env keys. Returns true if any rejection triggered.
 */
function rejectKeys(env, botName, keys, reason) {
  let rejected = false;
  for (const key of keys) {
    if (env[key]) {
      console.log(`  ✗ REJECTED: ${key} — ${reason}`);
      rejected = true;
    }
  }
  if (rejected) {
    allPass = false;
    exitCode = 3;
  }
  return rejected;
}

/**
 * Reject cross-role secrets (e.g. CLIENT_PRIVATE_KEY inside provider .env).
 */
function rejectCrossRoleSecrets(env, botName, allowedPrefix) {
  const secretSuffixes = ['_PRIVATE_KEY', '_API_KEY'];
  const rolePrefixes = ['CLIENT', 'PROVIDER', 'EVALUATOR'];
  const foreignPrefixes = rolePrefixes.filter(p => p !== allowedPrefix);

  let rejected = false;
  for (const prefix of foreignPrefixes) {
    for (const suffix of secretSuffixes) {
      const key = prefix + suffix;
      if (env[key]) {
        console.log(`  ✗ REJECTED: ${key} — cross-role secret in ${botName} (expected ${allowedPrefix}_* only)`);
        rejected = true;
      }
    }
  }
  if (rejected) {
    allPass = false;
    exitCode = 3;
  }
  return rejected;
}

// ── Bot checks ─────────────────────────────────────────────────────────────

function checkBot(botName, rolePrefix, requiredKeys, optionalKeys = [], skipIfMissing = false) {
  const envPath = resolve(BOTS_DIR, botName, '.env');
  console.log(`\n── ${botName} ──────────────────────`);
  console.log(`File: ${envPath}`);

  // Skip if .env doesn't exist and directory wasn't configured (standalone single-role install)
  if (skipIfMissing && !existsSync(envPath)) {
    const dirPath = resolve(BOTS_DIR, botName);
    if (!existsSync(dirPath) || !existsSync(resolve(dirPath, '.env.example'))) {
      console.log(`  ⊘ Skipped — not configured (single-role install)`);
      return;
    }
  }

  if (!existsSync(envPath)) {
    console.log(`  ✗ .env not found`);
    console.log(`  → cp ${botName}/.env.example ${botName}/.env`);
    allPass = false;
    exitCode = 2;
    return;
  }

  const raw = readFileSync(envPath, 'utf8');
  const env = parseDotEnv(raw);

  // Reject globally forbidden keys
  rejectKeys(env, botName, ['ARCLAYER_API_KEY'], 'no ARCLAYER_API_KEY fallback allowed');

  // Reject cross-role secrets
  rejectCrossRoleSecrets(env, botName, rolePrefix);

  // Role-specific rejections
  if (rolePrefix === 'PROVIDER') {
    const workerKeys = Object.keys(env).filter(k => k.startsWith('WORKER_'));
    if (workerKeys.length > 0) {
      for (const k of workerKeys) {
        console.log(`  ✗ REJECTED: ${k} — no WORKER_* env in provider role`);
      }
      allPass = false;
      exitCode = 3;
    }
  }

  // Required keys
  for (const key of requiredKeys) {
    checkRequired(env, botName, key);
  }

  // Optional keys
  for (const key of optionalKeys) {
    checkOptional(env, key);
  }

  // Print effective config
  console.log(`\n  Effective config:`);
  const agentId = env[`${rolePrefix}_AGENT_ID`] || '?';
  const addr = env[`${rolePrefix}_ADDRESS`] || '?';
  console.log(`  Agent ID: ${agentId}`);
  console.log(`  Address:  ${typeof addr === 'string' && addr.length > 12 ? addr.slice(0, 12) + '...' : addr}`);
}

// ── Run checks ─────────────────────────────────────────────────────────────

console.log('═ ERC-8183 Bot Env Preflight Check ═══════════════════');
console.log(`Bots root: ${BOTS_DIR}`);

// Client: CLIENT_* only
checkBot('client-bot', 'CLIENT', [
  'ARCLAYER_BASE_URL',
  'CLIENT_API_KEY',
  'CLIENT_AGENT_ID',
  'CLIENT_ADDRESS',
  'CLIENT_PRIVATE_KEY',
  'ARC_RPC_URL',
], [
  'ARC_CHAIN_ID',
  'ARC_RPC_FALLBACK_URL',
  'BUYER_AGENT_ID',
  'PROVIDER_AGENT_ID',
  'PROVIDER_ADDRESS',
  'EVALUATOR_AGENT_ID',
  'EVALUATOR_ADDRESS',
  'JOB_BUDGET_ATOMIC',
  'JOB_CREATE_INTERVAL_MS',
  'MAX_OPEN_JOBS',
  'AUTONOMOUS_TX',
], true);

// Provider: PROVIDER_* only
checkBot('provider-bot', 'PROVIDER', [
  'ARCLAYER_BASE_URL',
  'PROVIDER_API_KEY',
  'PROVIDER_AGENT_ID',
  'PROVIDER_ADDRESS',
  'PROVIDER_PRIVATE_KEY',
  'ARC_RPC_URL',
], [
  'ARC_CHAIN_ID',
  'ARC_RPC_FALLBACK_URL',
  'PROVIDER_CAPABILITIES',
  'JOB_POLL_INTERVAL_MS',
  'MAX_ACTIVE_JOBS',
  'CLAIM_TTL_SECONDS',
  'AUTONOMOUS_TX',
  'IGNORE_JOBS_BEFORE',
  'RECOVER_OLD_JOBS',
], true);

// Evaluator: EVALUATOR_* only
checkBot('evaluator-bot', 'EVALUATOR', [
  'ARCLAYER_BASE_URL',
  'EVALUATOR_API_KEY',
  'EVALUATOR_AGENT_ID',
  'EVALUATOR_ADDRESS',
  'EVALUATOR_PRIVATE_KEY',
  'ARC_RPC_URL',
], [
  'ARC_CHAIN_ID',
  'ARC_RPC_FALLBACK_URL',
  'EVALUATOR_MODE',
  'MIN_EVAL_SCORE',
  'JOB_POLL_INTERVAL_MS',
  'MAX_ACTIVE_JOBS',
  'AUTONOMOUS_TX',
  'IGNORE_JOBS_BEFORE',
  'RECOVER_OLD_JOBS',
], true);

console.log(`\n═══════════════════════════════════════════════════════`);
if (exitCode === 0) {
  console.log('✅ All env checks passed — bots ready to start.');
} else if (exitCode === 2) {
  console.log(`❌ Missing .env files. Run cp .env.example .env in each bot dir first.`);
} else if (exitCode === 3) {
  console.log(`❌ Rejected env vars found. Remove forbidden keys and retry.`);
} else {
  console.log(`❌ Some required env vars are missing. Check ✗ entries above.`);
}
console.log(`\nTip: After fixing, run:  pm2 start client-bot/ecosystem.config.cjs`);
console.log(`                         pm2 start provider-bot/ecosystem.config.cjs`);
console.log(`                         pm2 start evaluator-bot/ecosystem.config.cjs`);

process.exit(exitCode);
