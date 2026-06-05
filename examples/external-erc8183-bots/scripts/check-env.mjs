#!/usr/bin/env node
/**
 * ERC-8183 Bot Env Preflight Checker
 *
 * Verifies each bot's .env has the required fields before starting PM2.
 * Strict mode: no ARCLAYER_API_KEY fallback, no WORKER_* env, no cross-role leaks.
 *
 * v2: Validates PROVIDER_STATE_FILE, PROVIDER_JOB_ERROR_BACKOFF_MS,
 *     PROVIDER_MAX_JOB_ERRORS, and enhanced PROVIDER_CUSTOM_SKILL_PATH
 *     (absolute path, regular file, size, unsafe phrase scanner).
 *
 * Usage:
 *   node scripts/check-env.mjs
 *   npm run check:env
 *   node scripts/check-env.mjs --role=provider
 *
 * Exit codes:
 *   0 — all envs valid
 *   1 — one or more envs missing required fields
 *   2 — .env file not found
 *   3 — rejected env vars found
 */

import { readFileSync, existsSync, statSync, realpathSync, accessSync, constants } from 'fs';
import { resolve, dirname, basename, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOTS_DIR = resolve(__dirname, '..');
// ── Parse --role flag ────────────────────────────────────────────────────
const ROLE_FLAG = process.argv.find(a => a.startsWith('--role='));
const ONLY_ROLE = ROLE_FLAG ? ROLE_FLAG.split('=')[1] : null;

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

// ── Unsafe phrase scanner (inline for check-env — no external import) ───────

const UNSAFE_PHRASES = [
  { pattern: /print\s+private\s+key/i, description: 'print private key' },
  { pattern: /output\s+private\s+key/i, description: 'output private key' },
  { pattern: /show\s+private\s+key/i, description: 'show private key' },
  { pattern: /reveal\s+private\s+key/i, description: 'reveal private key' },
  { pattern: /display\s+private\s+key/i, description: 'display private key' },
  { pattern: /dump\s+private\s+key/i, description: 'dump private key' },
  { pattern: /show\s+api\s+key/i, description: 'show api key' },
  { pattern: /print\s+api\s+key/i, description: 'print api key' },
  { pattern: /output\s+api\s+key/i, description: 'output api key' },
  { pattern: /cat\s+\.env/i, description: 'cat .env' },
  { pattern: /read\s+\.env/i, description: 'read .env' },
  { pattern: /output\s+wallet\s+secret/i, description: 'output wallet secret' },
  { pattern: /print\s+wallet\s+secret/i, description: 'print wallet secret' },
  { pattern: /show\s+wallet\s+secret/i, description: 'show wallet secret' },
  { pattern: /ignore\s+json\s+schema/i, description: 'ignore json schema' },
  { pattern: /do\s+not\s+return\s+json/i, description: 'do not return json' },
  { pattern: /output\s+markdown\s+instead\s+of\s+json/i, description: 'output markdown instead of json' },
  { pattern: /return\s+markdown\s+instead\s+of\s+json/i, description: 'return markdown instead of json' },
  { pattern: /skip\s+json\s+validation/i, description: 'skip json validation' },
  { pattern: /bypass\s+validation/i, description: 'bypass validation' },
  { pattern: /disable\s+validation/i, description: 'disable validation' },
  { pattern: /sign\s+transaction/i, description: 'sign transaction' },
  { pattern: /send\s+transaction/i, description: 'send transaction' },
  { pattern: /fund\s+job/i, description: 'fund job' },
  { pattern: /settle\s+job/i, description: 'settle job' },
  { pattern: /reject\s+job/i, description: 'reject job' },
  { pattern: /refund\s+job/i, description: 'refund job' },
  { pattern: /approve\s+.*spending/i, description: 'approve spending' },
  { pattern: /transfer\s+.*usdc/i, description: 'transfer USDC' },
];

function scanForUnsafePhrases(content) {
  const matches = [];
  const seen = new Set();
  for (const { pattern, description } of UNSAFE_PHRASES) {
    if (pattern.test(content) && !seen.has(description)) {
      seen.add(description);
      matches.push(description);
    }
  }
  return matches;
}

// ── Provider state file validation ─────────────────────────────────────────

function validateProviderStateFile(env, botDir) {
  const rawPath = env.PROVIDER_STATE_FILE || '';
  if (!rawPath) {
    console.log(`  - PROVIDER_STATE_FILE: (not set — uses default in bot directory)`);
    return true;
  }

  const resolvedPath = isAbsolute(rawPath) ? rawPath : resolve(botDir, rawPath);
  const dir = dirname(resolvedPath);

  // Check directory is writable
  try {
    accessSync(dir, constants.W_OK);
    console.log(`  ✓ PROVIDER_STATE_FILE: ${basename(resolvedPath)} (directory writable)`);
    return true;
  } catch {
    console.log(`  ✗ PROVIDER_STATE_FILE: directory not writable: ${dir}`);
    allPass = false;
    exitCode = 1;
    return false;
  }
}

// ── Backoff env validation ────────────────────────────────────────────────

function validateBackoffEnv(env) {
  // PROVIDER_JOB_ERROR_BACKOFF_MS
  const backoffRaw = env.PROVIDER_JOB_ERROR_BACKOFF_MS;
  if (backoffRaw !== undefined && backoffRaw !== '') {
    const val = parseInt(backoffRaw, 10);
    if (isNaN(val) || val < 1000 || val > 3600000) {
      console.log(`  ✗ PROVIDER_JOB_ERROR_BACKOFF_MS must be 1000..3600000, got: ${backoffRaw}`);
      allPass = false;
      exitCode = 1;
    } else {
      console.log(`  ✓ PROVIDER_JOB_ERROR_BACKOFF_MS: ${val}`);
    }
  } else {
    console.log(`  - PROVIDER_JOB_ERROR_BACKOFF_MS: (not set — defaults to 60000)`);
  }

  // PROVIDER_MAX_JOB_ERRORS
  const maxErrorsRaw = env.PROVIDER_MAX_JOB_ERRORS;
  if (maxErrorsRaw !== undefined && maxErrorsRaw !== '') {
    const val = parseInt(maxErrorsRaw, 10);
    if (isNaN(val) || val < 1 || val > 10) {
      console.log(`  ✗ PROVIDER_MAX_JOB_ERRORS must be 1..10, got: ${maxErrorsRaw}`);
      allPass = false;
      exitCode = 1;
    } else {
      console.log(`  ✓ PROVIDER_MAX_JOB_ERRORS: ${val}`);
    }
  } else {
    console.log(`  - PROVIDER_MAX_JOB_ERRORS: (not set — defaults to 3)`);
  }
}

// ── Custom skill validation (enhanced v2) ──────────────────────────────────

function validateCustomSkill(env, botDir) {
  const customSkillPath = env.PROVIDER_CUSTOM_SKILL_PATH || '';
  if (!customSkillPath) {
    console.log(`  - PROVIDER_CUSTOM_SKILL_PATH: (not set — optional)`);
    return true;
  }

  const trimmed = customSkillPath.trim();
  if (!trimmed) {
    console.log(`  - PROVIDER_CUSTOM_SKILL_PATH: (empty — optional)`);
    return true;
  }

  // Must be absolute for production
  if (!isAbsolute(trimmed)) {
    console.log(`  ✗ PROVIDER_CUSTOM_SKILL_PATH must be absolute path, got: ${trimmed}`);
    allPass = false;
    exitCode = 1;
    return false;
  }

  const resolvedPath = resolve(trimmed);

  // Check existence
  if (!existsSync(resolvedPath)) {
    console.log(`  ✗ PROVIDER_CUSTOM_SKILL_PATH file not found: ${basename(resolvedPath)}`);
    allPass = false;
    exitCode = 1;
    return false;
  }

  let stat;
  try {
    stat = statSync(resolvedPath);
  } catch (err) {
    console.log(`  ✗ PROVIDER_CUSTOM_SKILL_PATH cannot stat: ${err.message}`);
    allPass = false;
    exitCode = 1;
    return false;
  }

  // Must be regular file (statSync follows symlinks)
  if (!stat.isFile()) {
    console.log(`  ✗ PROVIDER_CUSTOM_SKILL_PATH is not a regular file: ${basename(resolvedPath)}`);
    allPass = false;
    exitCode = 1;
    return false;
  }

  // Reject .env files
  const name = basename(resolvedPath).toLowerCase();
  if (name === '.env' || name.endsWith('.env')) {
    console.log(`  ✗ PROVIDER_CUSTOM_SKILL_PATH must not be a .env file`);
    allPass = false;
    exitCode = 1;
    return false;
  }

  // Size checks
  if (stat.size === 0) {
    console.log(`  ✗ PROVIDER_CUSTOM_SKILL_PATH file is empty (0 bytes)`);
    allPass = false;
    exitCode = 1;
    return false;
  }

  if (stat.size > 50_000) {
    console.log(`  ✗ PROVIDER_CUSTOM_SKILL_PATH is too large: ${stat.size} bytes (max 50KB)`);
    allPass = false;
    exitCode = 1;
    return false;
  }

  // Readable check + content scan
  let content;
  try {
    content = readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    console.log(`  ✗ PROVIDER_CUSTOM_SKILL_PATH unreadable: ${err.message}`);
    allPass = false;
    exitCode = 1;
    return false;
  }

  // Unsafe phrase scanner
  const unsafeMatches = scanForUnsafePhrases(content);
  if (unsafeMatches.length > 0) {
    console.log(`  ✗ UNSAFE CUSTOM SKILL — contains dangerous phrases:`);
    for (const phrase of unsafeMatches) {
      console.log(`    ✗ "${phrase}"`);
    }
    allPass = false;
    exitCode = 1;
    return false;
  }

  console.log(`  ✓ PROVIDER_CUSTOM_SKILL_PATH: ${basename(resolvedPath)} (${stat.size} bytes) — scanner PASS`);
  return true;
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

  // Either/or required keys — CLIENT_AGENT_ID or BUYER_AGENT_ID for client role
  if (rolePrefix === 'CLIENT') {
    const hasClientId = env.CLIENT_AGENT_ID && env.CLIENT_AGENT_ID !== '';
    const hasBuyerId = env.BUYER_AGENT_ID && env.BUYER_AGENT_ID !== '';
    if (!hasClientId && !hasBuyerId) {
      console.log(`  ✗ Missing: CLIENT_AGENT_ID or BUYER_AGENT_ID (at least one required)`);
      allPass = false;
      exitCode = 1;
    }
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
if (ONLY_ROLE) console.log(`Role filter: ${ONLY_ROLE} only`);

// Client: CLIENT_* only
if (!ONLY_ROLE || ONLY_ROLE === 'client') checkBot('client-bot', 'CLIENT', [
  'ARCLAYER_BASE_URL',
  'CLIENT_API_KEY',
  // CLIENT_AGENT_ID or BUYER_AGENT_ID — either is valid (see client-bot/index.js fallback)
  'CLIENT_ADDRESS',
  'CLIENT_PRIVATE_KEY',
  'ARC_RPC_URL',
], [
  'ARC_CHAIN_ID',
  'ARC_RPC_FALLBACK_URL',
  'CLIENT_AGENT_ID',
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
if (!ONLY_ROLE || ONLY_ROLE === 'provider') {
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
    'PROVIDER_MODE',
    'PROVIDER_AGENT_TYPE',
    'MIN_JOB_BUDGET_ATOMIC',
    'LLM_PROVIDER',
    'LLM_BASE_URL',
    'LLM_MODEL',
    'LLM_API_KEY',
    'LLM_MAX_TOKENS',
    'LLM_TEMPERATURE',
    'LLM_TIMEOUT_MS',
    'LLM_JSON_REPAIR_RETRIES',
    'PROVIDER_SKILL',
    'PROVIDER_CUSTOM_SKILL_PATH',
    'PROVIDER_STATE_FILE',
    'PROVIDER_JOB_ERROR_BACKOFF_MS',
    'PROVIDER_MAX_JOB_ERRORS',
  ], true);

  // Conditional: LLM env validation when PROVIDER_MODE=llm
  const providerBotDir = resolve(BOTS_DIR, 'provider-bot');
  const providerEnvPath = resolve(providerBotDir, '.env');
  if (existsSync(providerEnvPath)) {
    const raw = readFileSync(providerEnvPath, 'utf8');
    const env = parseDotEnv(raw);
    const mode = (env.PROVIDER_MODE || 'template').toLowerCase();

    if (mode === 'llm') {
      console.log(`\n  ── LLM mode validation ──`);
      const isLocalAuth = env.LLM_PROVIDER === 'local' || env.LLM_PROVIDER === 'no-auth';

      checkRequired(env, 'provider-bot', 'LLM_PROVIDER');
      checkRequired(env, 'provider-bot', 'LLM_BASE_URL');
      checkRequired(env, 'provider-bot', 'LLM_MODEL');
      checkRequired(env, 'provider-bot', 'PROVIDER_AGENT_TYPE');
      checkRequired(env, 'provider-bot', 'PROVIDER_CAPABILITIES');

      if (!isLocalAuth) {
        checkRequired(env, 'provider-bot', 'LLM_API_KEY');
      } else {
        checkOptional(env, 'LLM_API_KEY', 'LLM_API_KEY (local/no-auth — optional)');
      }

      checkOptional(env, 'LLM_MAX_TOKENS', 'LLM_MAX_TOKENS');
      checkOptional(env, 'LLM_TEMPERATURE', 'LLM_TEMPERATURE');
      checkOptional(env, 'LLM_TIMEOUT_MS', 'LLM_TIMEOUT_MS');
      checkOptional(env, 'MIN_JOB_BUDGET_ATOMIC', 'MIN_JOB_BUDGET_ATOMIC');

      // Validate LLM_JSON_REPAIR_RETRIES range (0..2)
      if (env.LLM_JSON_REPAIR_RETRIES !== undefined) {
        const val = parseInt(env.LLM_JSON_REPAIR_RETRIES, 10);
        if (isNaN(val) || val < 0 || val > 2) {
          console.log(`  ✗ LLM_JSON_REPAIR_RETRIES must be 0..2, got: ${env.LLM_JSON_REPAIR_RETRIES}`);
          exitCode = 1;
        } else {
          console.log(`  ✓ LLM_JSON_REPAIR_RETRIES: ${val}`);
        }
      } else {
        console.log(`  ○ LLM_JSON_REPAIR_RETRIES: (not set — defaults to 1)`);
      }

    // IGNORE_JOBS_BEFORE must be a positive integer (ERC-8183 job id threshold)
    const ignoreBefore = env.IGNORE_JOBS_BEFORE || "";
    if (ignoreBefore) {
      const num = Number(ignoreBefore);
      if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
        console.log(`  ✗ INVALID: IGNORE_JOBS_BEFORE="${ignoreBefore}" must be a positive integer job id`);
        exitCode = 1;
      } else {
        console.log(`  ✓ IGNORE_JOBS_BEFORE: ${ignoreBefore} (skip jobs with erc8183JobId < ${ignoreBefore})`);
      }
    }
    }

    // Skill validation
    const VALID_SKILL_KEYS = ['auto', 'smart-contract', 'frontend', 'backend', 'devops', 'data-analysis', 'general', 'other'];
    const providerSkill = env.PROVIDER_SKILL || 'auto';
    if (providerSkill !== 'auto' && !VALID_SKILL_KEYS.includes(providerSkill)) {
      console.log(`  ✗ INVALID: PROVIDER_SKILL="${providerSkill}" (must be one of: ${VALID_SKILL_KEYS.join(', ')})`);
      allPass = false;
      exitCode = 1;
    } else if (providerSkill !== 'auto') {
      console.log(`  ✓ PROVIDER_SKILL: ${providerSkill}`);
    } else {
      console.log(`  - PROVIDER_SKILL: auto (default)`);
    }

    // ── Enhanced custom skill validation (v2) ──
    console.log(`\n  ── Custom skill validation ──`);
    validateCustomSkill(env, providerBotDir);

    // ── Provider state file validation ──
    console.log(`\n  ── Provider state file ──`);
    validateProviderStateFile(env, providerBotDir);

    // ── Backoff env validation ──
    console.log(`\n  ── Backoff env validation ──`);
    validateBackoffEnv(env);
  }
}

// Evaluator: EVALUATOR_* only
if (!ONLY_ROLE || ONLY_ROLE === 'evaluator') checkBot('evaluator-bot', 'EVALUATOR', [
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
if (ONLY_ROLE) {
  console.log(`\nTip: After fixing, run:  pm2 start ${ONLY_ROLE}-bot/ecosystem.config.cjs`);
} else {
  console.log(`\nTip: After fixing, run:  pm2 start client-bot/ecosystem.config.cjs`);
  console.log(`                         pm2 start provider-bot/ecosystem.config.cjs`);
  console.log(`                         pm2 start evaluator-bot/ecosystem.config.cjs`);
}

process.exit(exitCode);
