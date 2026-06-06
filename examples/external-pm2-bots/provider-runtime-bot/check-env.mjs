#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Provider Runtime Bot — Preflight Environment Check
//
// Usage:
//   node check-env.mjs
//
// Validates .env has all required values before PM2 start.
// Exit 0 = pass, exit 1 = fail (with details).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');

// ── Load .env ────────────────────────────────────────────────────────────────

function loadEnv(path) {
  if (!existsSync(path)) {
    return {};
  }
  const content = readFileSync(path, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    env[key] = val;
  }
  return env;
}

// ── Validate ─────────────────────────────────────────────────────────────────

const env = loadEnv(envPath);
const errors = [];
const warnings = [];

// Required fields
const REQUIRED = [
  'ARCLAYER_BASE_URL',
  'ARCLAYER_MCP_TOKEN',
  'ARCLAYER_AGENT_ID',
  'PROVIDER_ADDRESS',
  'PROVIDER_PRIVATE_KEY',
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'LLM_MODEL',
];

for (const key of REQUIRED) {
  if (!env[key]) {
    errors.push(`Missing required: ${key}`);
  }
}

// Address format
if (env.PROVIDER_ADDRESS && !/^0x[a-fA-F0-9]{40}$/.test(env.PROVIDER_ADDRESS)) {
  errors.push(`Invalid PROVIDER_ADDRESS format: ${env.PROVIDER_ADDRESS}`);
}

// MCP token format
if (env.ARCLAYER_MCP_TOKEN && !env.ARCLAYER_MCP_TOKEN.startsWith('arc_mcp_sess_')) {
  errors.push(`ARCLAYER_MCP_TOKEN must start with arc_mcp_sess_`);
}

// Agent ID numeric
if (env.ARCLAYER_AGENT_ID && !/^\d+$/.test(env.ARCLAYER_AGENT_ID)) {
  errors.push(`ARCLAYER_AGENT_ID must be numeric: ${env.ARCLAYER_AGENT_ID}`);
}

// LLM_API_KEY required unless local/no-auth
const isLocalAuth = env.LLM_PROVIDER === 'local' || env.LLM_PROVIDER === 'no-auth';
if (!isLocalAuth && !env.LLM_API_KEY) {
  errors.push(`LLM_API_KEY required for provider "${env.LLM_PROVIDER}" (only optional for local/no-auth)`);
}

// Private key address match (if viem available)
if (env.PROVIDER_PRIVATE_KEY && env.PROVIDER_ADDRESS) {
  try {
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(env.PROVIDER_PRIVATE_KEY);
    if (account.address.toLowerCase() !== env.PROVIDER_ADDRESS.toLowerCase()) {
      errors.push(
        `PROVIDER_PRIVATE_KEY address (${account.address}) does not match PROVIDER_ADDRESS (${env.PROVIDER_ADDRESS})`
      );
    }
  } catch {
    warnings.push('Could not verify private key → address mapping (viem not installed yet)');
  }
}

// Custom skill path
if (env.PROVIDER_CUSTOM_SKILL_PATH && !existsSync(env.PROVIDER_CUSTOM_SKILL_PATH)) {
  warnings.push(`PROVIDER_CUSTOM_SKILL_PATH does not exist: ${env.PROVIDER_CUSTOM_SKILL_PATH}`);
}

// ── Report ───────────────────────────────────────────────────────────────────

console.log('');
console.log('═══ Provider Runtime Bot — Preflight Check ═══');
console.log('');

if (warnings.length > 0) {
  for (const w of warnings) {
    console.log(`  ⚠ ${w}`);
  }
  console.log('');
}

if (errors.length > 0) {
  for (const e of errors) {
    console.error(`  ✗ ${e}`);
  }
  console.log('');
  console.error('Preflight FAILED. Fix the issues above in .env');
  process.exit(1);
}

// Print config summary (no secrets)
console.log(`  Agent ID:      ${env.ARCLAYER_AGENT_ID}`);
console.log(`  Address:       ${env.PROVIDER_ADDRESS}`);
console.log(`  MCP Token:     ${env.ARCLAYER_MCP_TOKEN.slice(0, 20)}...`);
console.log(`  LLM Provider:  ${env.LLM_PROVIDER}`);
console.log(`  LLM Model:     ${env.LLM_MODEL}`);
console.log(`  LLM Key:       ${env.LLM_API_KEY ? '(set)' : '(empty)'}`);
console.log(`  Max Active:    ${env.PROVIDER_MAX_ACTIVE_RUNS || '1'}`);
console.log(`  Auto-Apply:    ${env.PROVIDER_AUTO_APPLY_OPEN_JOBS || 'false'}`);
console.log('');
console.log('  ✓ Preflight PASSED');
console.log('');
process.exit(0);
