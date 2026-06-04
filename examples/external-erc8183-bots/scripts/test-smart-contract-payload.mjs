#!/usr/bin/env node
/**
 * E2E test: Smart-contract payload preservation.
 *
 * Proves that a smart_contract_review job created via the API stores
 * and returns the full inputPayload (code, task, language, contractName, etc.)
 * so the provider LLM receives meaningful input.
 *
 * Usage:
 *   node scripts/test-smart-contract-payload.mjs
 *
 * Requires: CLIENT_API_KEY env or wallet session auth.
 * Does NOT require on-chain tx — tests API payload storage only.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.ARCLAYER_BASE_URL || 'https://arclayers.xyz';

// ── Load client wallet for auth ──────────────────────────────────────────
const CLIENT_ENV_PATH = resolve(__dirname, '..', 'client-bot', '.env');
let CLIENT_ADDRESS, CLIENT_PK;

try {
  const envText = readFileSync(CLIENT_ENV_PATH, 'utf8');
  const parse = (key) => {
    const m = envText.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  CLIENT_ADDRESS = parse('CLIENT_ADDRESS');
  CLIENT_PK = parse('CLIENT_PRIVATE_KEY');
} catch {
  console.error(`Cannot read ${CLIENT_ENV_PATH} — run from the bots directory`);
  process.exit(2);
}

if (!CLIENT_ADDRESS || !CLIENT_PK) {
  console.error('Missing CLIENT_ADDRESS or CLIENT_PRIVATE_KEY in .env');
  process.exit(2);
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json().catch(() => ({ ok: false, error: 'invalid_json' }));
  return { status: res.status, ...json };
}

async function getClientApiKey() {
  // Wallet session auth
  const nonceRes = await fetchJson(`/api/auth/wallet/nonce?address=${CLIENT_ADDRESS}`);
  if (!nonceRes.nonce) throw new Error('nonce failed: ' + JSON.stringify(nonceRes));

  // Sign with viem (dynamic import for ESM)
  const { privateKeyToAccount } = await import('viem/accounts');
  const pk = CLIENT_PK.startsWith('0x') ? CLIENT_PK : `0x${CLIENT_PK}`;
  const account = privateKeyToAccount(pk);
  const signature = await account.signMessage({ message: nonceRes.message });

  const verifyRes = await fetch(`${BASE}/api/auth/wallet/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: CLIENT_ADDRESS, signature, nonce: nonceRes.nonce }),
  });
  const cookie = verifyRes.headers.get('set-cookie')?.split(';')[0] || '';
  const verifyData = await verifyRes.json();
  if (!verifyData.ok) throw new Error('verify failed: ' + JSON.stringify(verifyData));

  // Create API key
  const keyRes = await fetch(`${BASE}/api/agents/${process.env.BUYER_AGENT_ID || '36191'}/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ label: `payload-test-${Date.now()}`, preset: 'client' }),
  });
  const keyData = await keyRes.json();
  if (!keyData.key) throw new Error('key creation failed: ' + JSON.stringify(keyData));
  return keyData.key;
}

// ── Test ─────────────────────────────────────────────────────────────────

async function run() {
  console.log('=== Smart-Contract Payload Preservation Test ===\n');

  // Step 1: Auth
  console.log('[1/4] Authenticating client...');
  const apiKey = await getClientApiKey();
  console.log('  ✓ API key obtained\n');

  // Step 2: Build the exact template the client bot would use
  console.log('[2/4] Building smart_contract_review inputPayload...');
  const inputPayload = {
    jobType: 'smart_contract_review',
    query: 'Review the Solidity escrow contract below for security and correctness. Identify issues, explain severity, and recommend fixes.',
    requiredCapability: 'solidity',
    difficulty: 'medium',
    task: 'smart-contract-review',
    language: 'solidity',
    contractName: 'SimpleEscrow',
    code: [
      'pragma solidity ^0.8.20;',
      '',
      'contract SimpleEscrow {',
      '    address public buyer;',
      '    address public seller;',
      '    uint256 public amount;',
      '    bool public funded;',
      '    bool public released;',
      '',
      '    constructor(address _seller) {',
      '        buyer = msg.sender;',
      '        seller = _seller;',
      '    }',
      '',
      '    function fund() external payable {',
      '        require(msg.sender == buyer, "only buyer");',
      '        require(!funded, "already funded");',
      '        amount = msg.value;',
      '        funded = true;',
      '    }',
      '',
      '    function release() external {',
      '        require(funded, "not funded");',
      '        require(!released, "released");',
      '        released = true;',
      '        payable(seller).transfer(amount);',
      '    }',
      '',
      '    function refund() external {',
      '        require(msg.sender == buyer, "only buyer");',
      '        require(funded, "not funded");',
      '        payable(buyer).transfer(address(this).balance);',
      '    }',
      '}',
    ].join('\n'),
    expectedDeliverable: 'Strict JSON with summary, findings, recommendations, confidence, and evidence.',
    acceptanceCriteria: [
      'Must identify at least one meaningful smart contract issue if present',
      'Must include severity per finding (info, low, medium, high, critical)',
      'Must recommend concrete fixes',
      'Must return valid strict JSON',
      'Must not include markdown outside JSON',
    ],
    nonce: crypto.randomBytes(8).toString('hex'),
    createdAt: new Date().toISOString(),
  };

  const expectedKeys = ['jobType', 'requiredCapability', 'task', 'language', 'contractName', 'code', 'difficulty', 'acceptanceCriteria', 'expectedDeliverable'];
  console.log(`  Expected keys: ${expectedKeys.join(', ')}`);
  console.log(`  code length: ${inputPayload.code.length} chars\n`);

  // Step 3: Create job via API
  console.log('[3/4] Creating job via POST /api/erc8183-jobs...');
  const createRes = await fetchJson('/api/erc8183-jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      buyerAgentId: process.env.BUYER_AGENT_ID || '36191',
      clientAddress: CLIENT_ADDRESS,
      providerAgentId: process.env.PROVIDER_AGENT_ID || '38502',
      providerAddress: '0x71B7A3ACC11Fa2b95CcA9734284b1a405b721B2E',
      evaluatorAgentId: process.env.EVALUATOR_AGENT_ID || '36202',
      evaluatorAddress: CLIENT_ADDRESS,
      expiredAtUnix: String(Math.floor(Date.now() / 1000) + 3600),
      description: '[smart_contract_review] Review the SimpleEscrow contract',
      budgetAtomic: '50000',
      inputPayload,
    }),
  });

  if (!createRes.localJobId) {
    console.error('  ✗ Create failed:', JSON.stringify(createRes).slice(0, 300));
    process.exit(1);
  }
  const localJobId = createRes.localJobId;
  console.log(`  ✓ Created: ${localJobId}\n`);

  // Step 4: Verify stored payload
  console.log('[4/4] Verifying stored inputPayload...');
  const detailRes = await fetchJson(`/api/erc8183-jobs/${localJobId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  const job = detailRes.job || detailRes;
  const storedPayload = job.inputPayload || job.payloads?.inputPayload || {};

  let pass = true;
  const results = [];

  for (const key of expectedKeys) {
    const present = storedPayload[key] !== undefined && storedPayload[key] !== null;
    const ok = present;
    results.push({ key, ok, present });
    if (!ok) pass = false;
  }

  // Special check: code content
  const codeMatch = storedPayload.code === inputPayload.code;
  if (!codeMatch) pass = false;
  results.push({ key: 'code_content_match', ok: codeMatch });

  // Print results
  console.log('  ┌─────────────────────────┬────────┐');
  console.log('  │ Field                   │ Status │');
  console.log('  ├─────────────────────────┼────────┤');
  for (const r of results) {
    const label = r.key.padEnd(23);
    const status = r.ok ? '  ✓   ' : '  ✗   ';
    console.log(`  │ ${label} │ ${status} │`);
  }
  console.log('  └─────────────────────────┴────────┘');

  if (pass) {
    console.log('\n✅ PASS — Full smart-contract inputPayload preserved.');
    console.log(`   Provider LLM will receive: code (${storedPayload.code?.length || 0} chars), task, language, contractName`);
  } else {
    console.log('\n❌ FAIL — Some fields missing from stored payload.');
    console.log('   Stored keys:', Object.keys(storedPayload).join(', '));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
