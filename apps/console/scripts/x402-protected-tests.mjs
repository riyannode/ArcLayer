#!/usr/bin/env node
// x402-protected-tests.mjs — 9 scenario test suite for the x402 protected resource endpoint
// Runs against deployed Vercel (arclayers.xyz) or local (localhost:3000)
// Usage: node scripts/x402-protected-tests.mjs [--local]

import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { createPublicClient, http, getAddress, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const LOCAL = process.argv.includes('--local');
const BASE = LOCAL ? 'http://localhost:3000' : 'https://arclayers.xyz';
const RPC_URL = 'https://rpc.testnet.arc.network';
const CHAIN_ID = 5042002;
const USDC = getAddress('0x3600000000000000000000000000000000000000');
const NETWORK = 'eip155:5042002';

let payerPk;
try { payerPk = readFileSync('/tmp/x402_payer.pk', 'utf8').trim(); } catch {
  console.error('ERROR: /tmp/x402_payer.pk not found. Write payer private key there.');
  process.exit(1);
}
const payer = privateKeyToAccount(payerPk);
const publicClient = createPublicClient({ transport: http(RPC_URL) });

let passed = 0, failed = 0;

function b64(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64'); }

async function test(name, fn) {
  process.stdout.write(`  [${passed + failed + 1}] ${name}... `);
  try {
    await fn();
    passed++;
    console.log('✅ PASS');
  } catch (e) {
    failed++;
    console.log(`❌ FAIL: ${e.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

async function signAuth(amount, payTo, validBefore, nonce) {
  const authorization = { from: payer.address, to: payTo, value: amount, validAfter: 0n, validBefore, nonce };
  const signature = await payer.signTypedData({
    domain: { name: 'USDC', version: '2', chainId: CHAIN_ID, verifyingContract: USDC },
    types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  });
  return { signature, authorization };
}

function buildPayload(signature, authorization, payTo, amount) {
  return {
    x402Version: 2,
    accepted: { scheme: 'exact', network: NETWORK, asset: USDC, amount: amount.toString(), payTo, maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2', decimals: 6 } },
    payload: {
      signature,
      authorization: { from: authorization.from, to: authorization.to, value: authorization.value.toString(), validAfter: authorization.validAfter.toString(), validBefore: authorization.validBefore.toString(), nonce: authorization.nonce },
    },
  };
}

console.log(`\n🧪 x402 Protected Resource Tests — ${BASE}\n`);

// Fetch requirements first
const challengeResp = await fetch(`${BASE}/api/x402-demo/protected`);
const challengeJson = await challengeResp.json();
assert(challengeResp.status === 402, 'Expected 402 from challenge');
const req = challengeJson.paymentRequirements;
const PAY_TO = getAddress(req.payTo);
const AMOUNT = BigInt(req.amount);

console.log(`  Target: ${BASE}/api/x402-demo/protected`);
console.log(`  PayTo: ${PAY_TO}`);
console.log(`  Amount: ${formatUnits(AMOUNT, 6)} USDC`);
console.log(`  Payer: ${payer.address}\n`);

// ─── TEST 1: No header → 402 ───
await test('No header returns 402 with paymentRequirements', async () => {
  const r = await fetch(`${BASE}/api/x402-demo/protected`);
  assert(r.status === 402, `Expected 402, got ${r.status}`);
  const j = await r.json();
  assert(j.paymentRequirements, 'Missing paymentRequirements');
  assert(j.paymentRequirements.scheme === 'exact', 'Wrong scheme');
  assert(j.x402Version === 2, 'Wrong x402Version');
});

// ─── TEST 2: Invalid base64 header → 402 ───
await test('Invalid base64 X-PAYMENT header returns 402', async () => {
  const r = await fetch(`${BASE}/api/x402-demo/protected`, { headers: { 'X-PAYMENT': 'not-valid-json-or-base64!!!' } });
  assert(r.status === 402, `Expected 402, got ${r.status}`);
});

// ─── TEST 3: Valid JSON but missing fields → 402 ───
await test('Valid JSON but missing authorization fields returns 402', async () => {
  const payload = b64({ x402Version: 2, payload: { signature: '0xdead' } });
  const r = await fetch(`${BASE}/api/x402-demo/protected`, { headers: { 'X-PAYMENT': payload } });
  assert(r.status === 402, `Expected 402, got ${r.status}`);
  const j = await r.json();
  assert(j.error === 'invalid_payment_proof', `Expected invalid_payment_proof, got ${j.error}`);
});

// ─── TEST 4: Valid signature but nonce NOT used on-chain → 402 (not settled) ───
await test('Valid signature but unsettled nonce returns 402', async () => {
  const nonce = `0x${randomBytes(32).toString('hex')}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const { signature, authorization } = await signAuth(AMOUNT, PAY_TO, validBefore, nonce);
  const pp = buildPayload(signature, authorization, PAY_TO, AMOUNT);
  const r = await fetch(`${BASE}/api/x402-demo/protected`, { headers: { 'X-PAYMENT': b64(pp) } });
  assert(r.status === 402, `Expected 402, got ${r.status}`);
  const j = await r.json();
  assert(j.error === 'not_settled' || j.error === 'nonce_not_used' || j.error === 'settlement_not_found', `Expected not_settled/nonce_not_used/settlement_not_found, got ${j.error}`);
});

// ─── TEST 5: Wrong payTo address → 402 ───
await test('Wrong payTo address returns 402', async () => {
  const wrongPayTo = getAddress('0x0000000000000000000000000000000000000001');
  const nonce = `0x${randomBytes(32).toString('hex')}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const { signature, authorization } = await signAuth(AMOUNT, wrongPayTo, validBefore, nonce);
  const pp = buildPayload(signature, authorization, wrongPayTo, AMOUNT);
  const r = await fetch(`${BASE}/api/x402-demo/protected`, { headers: { 'X-PAYMENT': b64(pp) } });
  assert(r.status === 402, `Expected 402, got ${r.status}`);
});

// ─── TEST 6: Wrong amount → 402 ───
await test('Insufficient amount returns 402', async () => {
  const smallAmount = 1n; // 0.000001 USDC
  const nonce = `0x${randomBytes(32).toString('hex')}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const { signature, authorization } = await signAuth(smallAmount, PAY_TO, validBefore, nonce);
  const pp = buildPayload(signature, authorization, PAY_TO, smallAmount);
  const r = await fetch(`${BASE}/api/x402-demo/protected`, { headers: { 'X-PAYMENT': b64(pp) } });
  assert(r.status === 402, `Expected 402, got ${r.status}`);
});

// ─── TEST 7: Expired authorization → 402 ───
await test('Expired validBefore returns 402', async () => {
  const nonce = `0x${randomBytes(32).toString('hex')}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) - 60); // expired 1 min ago
  const { signature, authorization } = await signAuth(AMOUNT, PAY_TO, validBefore, nonce);
  const pp = buildPayload(signature, authorization, PAY_TO, AMOUNT);
  const r = await fetch(`${BASE}/api/x402-demo/protected`, { headers: { 'X-PAYMENT': b64(pp) } });
  assert(r.status === 402, `Expected 402, got ${r.status}`);
});

// ─── TEST 8: PAYMENT-SIGNATURE alias header works same as X-PAYMENT ───
await test('PAYMENT-SIGNATURE alias header is accepted', async () => {
  const nonce = `0x${randomBytes(32).toString('hex')}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const { signature, authorization } = await signAuth(AMOUNT, PAY_TO, validBefore, nonce);
  const pp = buildPayload(signature, authorization, PAY_TO, AMOUNT);
  const r = await fetch(`${BASE}/api/x402-demo/protected`, { headers: { 'PAYMENT-SIGNATURE': b64(pp) } });
  // Should get 402 (nonce not settled) but NOT 'invalid_payment_proof' — means header was parsed
  assert(r.status === 402, `Expected 402, got ${r.status}`);
  const j = await r.json();
  assert(j.error !== 'invalid_payment_proof', `Header was not parsed — got invalid_payment_proof`);
});

// ─── TEST 9: Relayer status endpoint returns valid JSON ───
await test('/api/x402/relayer-status returns valid status', async () => {
  const r = await fetch(`${BASE}/api/x402/relayer-status`);
  assert(r.ok, `Expected 200, got ${r.status}`);
  const j = await r.json();
  assert(typeof j.configured === 'boolean', 'Missing configured field');
  assert(typeof j.ready === 'boolean', 'Missing ready field');
  assert(j.chainId === CHAIN_ID, `Wrong chainId: ${j.chainId}`);
  assert(j.asset === USDC, `Wrong asset: ${j.asset}`);
});

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
process.exit(failed > 0 ? 1 : 0);
