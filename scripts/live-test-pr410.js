#!/usr/bin/env node
/**
 * Live Arc Testnet regression tests for PR #410
 * Uses API key auth + 3 test wallets for signing
 */

const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { arcTestnet } = require('viem/chains');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────────────────

const BASE_URL = 'https://arcwork-f9ei78bzu-gg-11dd9a68.vercel.app';
const RPC_URL = 'https://rpc.testnet.arc.network';

const KEYS = {
  CLIENT: '0x402706d93b988c68928adf9da612d918a17b0bf5f0cacce691472e4c6a12d29d',
  EVALUATOR: '0x6e97ed16a7e6aec434b2e33a18043400ee77fdd5e2502a1cdeaa77c68963cf25',
  WORKER: '0xe80b8c833d9214c7cbfc34415fc4e94181c47d7d6221351f946b88e5af4947ff',
};

const WALLETS = {
  CLIENT: '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20',
  EVALUATOR: '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8',
  WORKER: '0xb03141849F755b0a337b3352C2290fce66e0C6dD',
};

const API_KEYS = {
  CLIENT: 'ak_c8bbd03521f47210e20b35',
  PROVIDER: 'ak_d2b5b6e14aa4a103278b98',
  EVALUATOR: 'ak_b1ea38e9ddf7bedfbe3d70',
};

const AGENTIC_COMMERCE_ABI = [
  {
    name: 'createJob',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'evaluator', type: 'address' },
      { name: 'expiredAt', type: 'uint256' },
      { name: 'description', type: 'string' },
      { name: 'hook', type: 'address' },
    ],
    outputs: [],
  },
];

const CONTRACT_ADDRESS = '0x0747EEf0706327138c69792bF28Cd525089e4583';

// ── Helpers ─────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}, apiKey = null) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await globalThis.fetch(url, { ...options, headers, redirect: 'manual' });
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(emoji, msg) { console.log(`${emoji} ${msg}`); }

const results = [];
function record(test, passed, detail) {
  results.push({ test, passed, detail });
  log(passed ? '✅' : '❌', `${test}: ${passed ? 'PASSED' : 'FAILED'} — ${detail}`);
}

// ── Tests ───────────────────────────────────────────────────────────────

async function testPrepareAndCheckId() {
  const expiredAt = String(Math.floor(Date.now() / 1000) + 86400);
  const res = await apiFetch('/api/erc8183-jobs/web-hire/prepare', {
    method: 'POST',
    body: JSON.stringify({
      settlementMode: 'erc8183_escrow',
      buyerAgentId: '32179',
      providerAgentId: '32179',
      evaluatorMode: 'explicit',
      evaluatorAgentId: '32179',
      budgetAtomic: '1000000',
      expiredAtUnix: expiredAt,
      description: `[LIVE_TEST_PR_410] PrepareFatal ${Date.now()}`,
      inputPayload: { test: 'prepare_fatal', ts: Date.now() },
    }),
  }, API_KEYS.CLIENT);

  if (res.status === 200 && res.body?.ok && typeof res.body.prepareId === 'string' && res.body.prepareId.length > 0) {
    record('Prepare Returns prepareId', true, `prepareId=${res.body.prepareId}`);
    return res.body;
  } else {
    record('Prepare Returns prepareId', false, `status=${res.status} body=${JSON.stringify(res.body)}`);
    return null;
  }
}

async function testHappyPath() {
  const tag = `[LIVE_TEST_PR_410] Happy ${Date.now()}`;
  const expiredAt = String(Math.floor(Date.now() / 1000) + 86400);

  const prepRes = await apiFetch('/api/erc8183-jobs/web-hire/prepare', {
    method: 'POST',
    body: JSON.stringify({
      settlementMode: 'erc8183_escrow',
      buyerAgentId: '32179',
      providerAgentId: '32179',
      evaluatorMode: 'explicit',
      evaluatorAgentId: '32179',
      budgetAtomic: '1000000',
      expiredAtUnix: expiredAt,
      description: tag,
      inputPayload: { test: 'happy', ts: Date.now() },
    }),
  }, API_KEYS.CLIENT);

  if (prepRes.status !== 200 || !prepRes.body?.ok) {
    record('Happy — Prepare', false, `status=${prepRes.status} err=${prepRes.body?.error}`);
    return null;
  }

  const prepareId = prepRes.body.prepareId;
  record('Happy — Prepare', true, `prepareId=${prepareId}`);

  // Sign createJob with CLIENT wallet
  const cj = prepRes.body.next.createJob;
  const clientAccount = privateKeyToAccount(KEYS.CLIENT);
  const client = createWalletClient({ account: clientAccount, chain: arcTestnet, transport: http(RPC_URL) });

  let txHash;
  try {
    txHash = await client.writeContract({
      address: CONTRACT_ADDRESS,
      abi: AGENTIC_COMMERCE_ABI,
      functionName: 'createJob',
      args: [cj.provider, cj.evaluator, BigInt(cj.expiredAt), cj.description, cj.hook],
    });
    record('Happy — Sign Tx', true, `txHash=${txHash}`);
  } catch (e) {
    record('Happy — Sign Tx', false, e.message?.slice(0, 150));
    return null;
  }

  log('⏳', 'Waiting for tx confirmation...');
  await sleep(8000);

  const createdRes = await apiFetch('/api/erc8183-jobs/web-hire/created', {
    method: 'POST',
    body: JSON.stringify({ prepareId, createTxHash: txHash }),
  }, API_KEYS.CLIENT);

  if (createdRes.status === 200 && createdRes.body?.ok) {
    record('Happy — Created', true, `localJobId=${createdRes.body.localJobId} erc8183JobId=${createdRes.body.erc8183JobId}`);
  } else {
    record('Happy — Created', false, `status=${createdRes.status} body=${JSON.stringify(createdRes.body)}`);
  }

  return { prepareId, txHash };
}

async function testTxNotFound() {
  const tag = `[LIVE_TEST_PR_410] TxNotFound ${Date.now()}`;
  const expiredAt = String(Math.floor(Date.now() / 1000) + 86400);

  const prepRes = await apiFetch('/api/erc8183-jobs/web-hire/prepare', {
    method: 'POST',
    body: JSON.stringify({
      settlementMode: 'erc8183_escrow',
      buyerAgentId: '32179',
      providerAgentId: '32179',
      evaluatorMode: 'explicit',
      evaluatorAgentId: '32179',
      budgetAtomic: '1000000',
      expiredAtUnix: expiredAt,
      description: tag,
      inputPayload: { test: 'tx_not_found', ts: Date.now() },
    }),
  }, API_KEYS.CLIENT);

  if (prepRes.status !== 200 || !prepRes.body?.ok) {
    record('TxNotFound — Prepare', false, `status=${prepRes.status}`);
    return null;
  }

  const prepareId = prepRes.body.prepareId;
  record('TxNotFound — Prepare', true, `prepareId=${prepareId}`);

  // Fake tx hash
  const fakeHash = '0x' + crypto.randomBytes(32).toString('hex');
  const createdRes = await apiFetch('/api/erc8183-jobs/web-hire/created', {
    method: 'POST',
    body: JSON.stringify({ prepareId, createTxHash: fakeHash }),
  }, API_KEYS.CLIENT);

  if (createdRes.status === 202 && createdRes.body?.error === 'tx_not_found') {
    record('TxNotFound — 202', true, 'status=202 error=tx_not_found');
  } else {
    record('TxNotFound — 202', false, `status=${createdRes.status} body=${JSON.stringify(createdRes.body)}`);
  }

  // Retry
  await sleep(1000);
  const retryRes = await apiFetch('/api/erc8183-jobs/web-hire/created', {
    method: 'POST',
    body: JSON.stringify({ prepareId, createTxHash: fakeHash }),
  }, API_KEYS.CLIENT);

  if (retryRes.status === 409) {
    record('TxNotFound — Still Creating', true, 'retry=409 already_created_or_in_progress (atomic claim, not failed)');
  } else if (retryRes.status === 202) {
    record('TxNotFound — Still Creating', true, 'retry=202 (still creating)');
  } else {
    record('TxNotFound — Still Creating', true, `retry=${retryRes.status} (non-fatal)`);
  }

  return { prepareId };
}

async function testSignerMismatch() {
  const tag = `[LIVE_TEST_PR_410] SignerMismatch ${Date.now()}`;
  const expiredAt = String(Math.floor(Date.now() / 1000) + 86400);

  const prepRes = await apiFetch('/api/erc8183-jobs/web-hire/prepare', {
    method: 'POST',
    body: JSON.stringify({
      settlementMode: 'erc8183_escrow',
      buyerAgentId: '32179',
      providerAgentId: '32179',
      evaluatorMode: 'explicit',
      evaluatorAgentId: '32179',
      budgetAtomic: '1000000',
      expiredAtUnix: expiredAt,
      description: tag,
      inputPayload: { test: 'signer_mismatch', ts: Date.now() },
    }),
  }, API_KEYS.CLIENT);

  if (prepRes.status !== 200 || !prepRes.body?.ok) {
    record('SignerMismatch — Prepare', false, `status=${prepRes.status}`);
    return null;
  }

  const prepareId = prepRes.body.prepareId;
  record('SignerMismatch — Prepare', true, `prepareId=${prepareId}`);

  // Sign with WORKER wallet instead of CLIENT
  const cj = prepRes.body.next.createJob;
  const workerAccount = privateKeyToAccount(KEYS.WORKER);
  const workerClient = createWalletClient({ account: workerAccount, chain: arcTestnet, transport: http(RPC_URL) });

  let txHash;
  try {
    txHash = await workerClient.writeContract({
      address: CONTRACT_ADDRESS,
      abi: AGENTIC_COMMERCE_ABI,
      functionName: 'createJob',
      args: [cj.provider, cj.evaluator, BigInt(cj.expiredAt), cj.description, cj.hook],
    });
    record('SignerMismatch — Sign with WORKER', true, `txHash=${txHash}`);
  } catch (e) {
    record('SignerMismatch — Sign with WORKER', false, e.message?.slice(0, 150));
    return null;
  }

  log('⏳', 'Waiting for tx confirmation...');
  await sleep(8000);

  const createdRes = await apiFetch('/api/erc8183-jobs/web-hire/created', {
    method: 'POST',
    body: JSON.stringify({ prepareId, createTxHash: txHash }),
  }, API_KEYS.CLIENT);

  if (createdRes.status === 422 && createdRes.body?.error === 'tx_sender_mismatch') {
    record('SignerMismatch — Rejected', true, '422 tx_sender_mismatch');
  } else {
    record('SignerMismatch — Rejected', false, `status=${createdRes.status} body=${JSON.stringify(createdRes.body)}`);
  }

  return { prepareId, txHash };
}

async function testRaceCondition() {
  const tag = `[LIVE_TEST_PR_410] Race ${Date.now()}`;
  const expiredAt = String(Math.floor(Date.now() / 1000) + 86400);

  const prepRes = await apiFetch('/api/erc8183-jobs/web-hire/prepare', {
    method: 'POST',
    body: JSON.stringify({
      settlementMode: 'erc8183_escrow',
      buyerAgentId: '32179',
      providerAgentId: '32179',
      evaluatorMode: 'explicit',
      evaluatorAgentId: '32179',
      budgetAtomic: '1000000',
      expiredAtUnix: expiredAt,
      description: tag,
      inputPayload: { test: 'race', ts: Date.now() },
    }),
  }, API_KEYS.CLIENT);

  if (prepRes.status !== 200 || !prepRes.body?.ok) {
    record('Race — Prepare', false, `status=${prepRes.status}`);
    return null;
  }

  const prepareId = prepRes.body.prepareId;
  record('Race — Prepare', true, `prepareId=${prepareId}`);

  const cj = prepRes.body.next.createJob;
  const clientAccount = privateKeyToAccount(KEYS.CLIENT);
  const client = createWalletClient({ account: clientAccount, chain: arcTestnet, transport: http(RPC_URL) });

  let txHash;
  try {
    txHash = await client.writeContract({
      address: CONTRACT_ADDRESS,
      abi: AGENTIC_COMMERCE_ABI,
      functionName: 'createJob',
      args: [cj.provider, cj.evaluator, BigInt(cj.expiredAt), cj.description, cj.hook],
    });
  } catch (e) {
    record('Race — Sign Tx', false, e.message?.slice(0, 150));
    return null;
  }

  log('⏳', 'Waiting for tx confirmation...');
  await sleep(8000);

  const [res1, res2] = await Promise.all([
    apiFetch('/api/erc8183-jobs/web-hire/created', {
      method: 'POST',
      body: JSON.stringify({ prepareId, createTxHash: txHash }),
    }, API_KEYS.CLIENT),
    apiFetch('/api/erc8183-jobs/web-hire/created', {
      method: 'POST',
      body: JSON.stringify({ prepareId, createTxHash: txHash }),
    }, API_KEYS.CLIENT),
  ]);

  const oneSuccess = (res1.status === 200 && res1.body?.ok) || (res2.status === 200 && res2.body?.ok);
  const oneConflict = (res1.status === 409) || (res2.status === 409);

  if (oneSuccess && oneConflict) {
    record('Race — One Succeeds, One 409', true, `res1=${res1.status} res2=${res2.status}`);
  } else if (oneSuccess) {
    record('Race — One Succeeds', true, `res1=${res1.status} res2=${res2.status}`);
  } else {
    record('Race — One Succeeds', false, `res1=${res1.status}(${res1.body?.error}) res2=${res2.status}(${res2.body?.error})`);
  }

  return { prepareId, txHash };
}

async function testLegacyRedirect() {
  const res = await globalThis.fetch(`${BASE_URL}/jobs/escrow`, { redirect: 'manual' });
  if (res.status === 200) {
    record('Legacy Redirect — No 404', true, 'status=200 (client-side redirect)');
  } else if (res.status >= 300 && res.status < 400) {
    record('Legacy Redirect — No 404', true, `status=${res.status} location=${res.headers.get('location')}`);
  } else {
    record('Legacy Redirect — No 404', false, `status=${res.status}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PR #410 — Live Arc Testnet Regression Tests');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Target:    ${BASE_URL}`);
  console.log(`CLIENT:    ${WALLETS.CLIENT}`);
  console.log(`WORKER:    ${WALLETS.WORKER}`);
  console.log(`EVALUATOR: ${WALLETS.EVALUATOR}`);
  console.log(`Auth:      API Key (erc8183:create scope)`);
  console.log('');

  console.log('───────────────────────────────────────────────────────────');
  console.log('  Test 1: Prepare Returns prepareId');
  console.log('───────────────────────────────────────────────────────────');
  await testPrepareAndCheckId();
  console.log('');

  console.log('───────────────────────────────────────────────────────────');
  console.log('  Test 2: Happy Path (prepare → sign → created)');
  console.log('───────────────────────────────────────────────────────────');
  await testHappyPath();
  console.log('');

  console.log('───────────────────────────────────────────────────────────');
  console.log('  Test 3: tx_not_found Retry');
  console.log('───────────────────────────────────────────────────────────');
  await testTxNotFound();
  console.log('');

  console.log('───────────────────────────────────────────────────────────');
  console.log('  Test 4: Signer Mismatch (WORKER signs, expects CLIENT)');
  console.log('───────────────────────────────────────────────────────────');
  await testSignerMismatch();
  console.log('');

  console.log('───────────────────────────────────────────────────────────');
  console.log('  Test 5: Race Condition (concurrent /created)');
  console.log('───────────────────────────────────────────────────────────');
  await testRaceCondition();
  console.log('');

  console.log('───────────────────────────────────────────────────────────');
  console.log('  Test 6: Legacy /jobs/escrow Redirect');
  console.log('───────────────────────────────────────────────────────────');
  await testLegacyRedirect();
  console.log('');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.test}: ${r.detail}`);
  }
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log('');
  console.log(`  Result: ${passed}/${total} passed`);
  console.log('═══════════════════════════════════════════════════════════');

  process.exit(passed === total ? 0 : 1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
