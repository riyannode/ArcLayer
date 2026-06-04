/**
 * Live regression: PR #410 event validation (expiredAt mismatch + hook mismatch)
 *
 * Uses real Arc Testnet txs against the /api/erc8183-jobs/web-hire endpoints.
 * Run: cd apps/console && npx tsx scripts/live-pr410-event-validation.mts
 */

import { createWalletClient, http, publicActions, encodeFunctionData, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ── Config ──────────────────────────────────────────────────────────────────

const BASE_URL = 'https://arcwork-hx01va7aq-gg-11dd9a68.vercel.app';
const ARC_CHAIN = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
    public: { http: ['https://rpc.testnet.arc.network'] },
  },
} as const;
const RPC_URL = 'https://rpc.testnet.arc.network';

const CLIENT_PK = '0x402706d93b988c68928adf9da612d918a17b0bf5f0cacce691472e4c6a12d29d' as Hex;
const CLIENT_ADDR = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
const WORKER_ADDR = '0xb03141849F755b0a337b3352C2290fce66e0C6dD';
const EVALUATOR_ADDR = '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8';

const AGENTIC_COMMERCE = '0x0747EEf0706327138c69792bF28Cd525089e4583' as Hex;

const CREATE_JOB_ABI = [
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
] as const;

const DESCRIPTION_PREFIX = '[LIVE_TEST_PR_410_EVENT_VALIDATION]';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const setCookie = res.headers.get('set-cookie');
  const data = await res.json();
  return { status: res.status, data, setCookie };
}

async function apiPost(path: string, body: Record<string, unknown>, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  return apiFetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

function extractSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  // Parse: arclayer-wallet-session=<token>; Path=/; HttpOnly; ...
  const match = setCookie.match(/(arclayer-wallet-session=[^;]+)/);
  return match ? match[1] : null;
}

async function authenticateWallet(): Promise<string> {
  console.log('[auth] Getting nonce...');
  const nonceRes = await apiFetch(`/api/auth/wallet/nonce?address=${CLIENT_ADDR}`);
  console.log(`[auth] nonce status=${nonceRes.status} ok=${nonceRes.data.ok}`);
  if (!nonceRes.data.ok) throw new Error(`nonce failed: ${JSON.stringify(nonceRes.data)}`);

  const { nonce, message } = nonceRes.data;
  console.log(`[auth] Signing message: "${message.slice(0, 80)}..."`);

  const client = createWalletClient({
    account: privateKeyToAccount(CLIENT_PK),
    chain: ARC_CHAIN,
    transport: http(RPC_URL),
  });

  const signature = await client.signMessage({ message });
  console.log(`[auth] signature=${signature.slice(0, 20)}...`);

  const verifyRes = await apiFetch('/api/auth/wallet/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: CLIENT_ADDR, nonce, signature }),
  });
  console.log(`[auth] verify status=${verifyRes.status} ok=${verifyRes.data.ok}`);

  if (!verifyRes.data.ok) throw new Error(`verify failed: ${JSON.stringify(verifyRes.data)}`);

  const cookie = extractSessionCookie(verifyRes.setCookie);
  if (!cookie) throw new Error('No session cookie returned');
  console.log(`[auth] session cookie obtained ✓`);
  return cookie;
}

function makeClient(pk: Hex) {
  const account = privateKeyToAccount(pk);
  return createWalletClient({
    account,
    chain: ARC_CHAIN,
    transport: http(RPC_URL),
  }).extend(publicActions);
}

// ── Test 1: expiredAt mismatch ──────────────────────────────────────────────

async function testExpiredAtMismatch(cookie: string) {
  console.log('\n═══ TEST 1: expiredAt mismatch ═══\n');

  const nowUnix = Math.floor(Date.now() / 1000);
  const prepExpiredAt = String(nowUnix + 7200);

  console.log(`[prepare] expiredAt=${prepExpiredAt}...`);
  const prepRes = await apiPost('/api/erc8183-jobs/web-hire/prepare', {
    settlementMode: 'erc8183_escrow',
    buyerAgentId: '32179',
    providerAgentId: '32965',
    evaluatorAgentId: '32966',
    budgetAtomic: '100000',
    expiredAtUnix: prepExpiredAt,
    description: `${DESCRIPTION_PREFIX} Test1 expiredAt mismatch ${Date.now()}`,
    inputPayload: { test: 'event_expired_at_validation' },
  }, cookie);

  console.log(`[prepare] status=${prepRes.status} ok=${prepRes.data.ok}`);
  if (!prepRes.data.ok) {
    console.error('[prepare] FAILED:', JSON.stringify(prepRes.data, null, 2));
    return { pass: false, error: 'prepare_failed', detail: prepRes.data.detail };
  }

  const prepareId = prepRes.data.prepareId;
  const prepNext = prepRes.data.next?.createJob;
  const prepHook = prepNext?.hook || '0x0000000000000000000000000000000000000000';
  const prepProvider = prepNext?.provider;
  const prepEvaluator = prepNext?.evaluator;
  const description = prepNext?.description || `${DESCRIPTION_PREFIX} Test1`;

  console.log(`[prepare] prepareId=${prepareId}`);
  console.log(`[prepare] prep.expiredAt=${prepExpiredAt}`);
  console.log(`[prepare] prep.hook=${prepHook}`);
  console.log(`[prepare] prep.provider=${prepProvider}`);
  console.log(`[prepare] prep.evaluator=${prepEvaluator}`);

  // Create on-chain createJob with DIFFERENT expiredAt (+1 hour)
  const differentExpiredAt = BigInt(prepExpiredAt) + 3600n;
  console.log(`\n[tx] Sending createJob with different expiredAt=${differentExpiredAt}...`);

  const client = makeClient(CLIENT_PK);
  const txHash = await client.sendTransaction({
    to: AGENTIC_COMMERCE,
    data: encodeFunctionData({
      abi: CREATE_JOB_ABI,
      functionName: 'createJob',
      args: [
        prepProvider as Hex,
        prepEvaluator as Hex,
        differentExpiredAt,
        description,
        prepHook as Hex,
      ],
    }),
  });

  console.log(`[tx] txHash=${txHash}`);
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
  console.log(`[tx] status=${receipt.status} block=${receipt.blockNumber}`);

  if (receipt.status !== 'success') {
    return { pass: false, error: 'tx_reverted', txHash, prepareId };
  }

  // Submit to /created — should reject
  console.log(`\n[created] Submitting mismatched txHash...`);
  const createdRes = await apiPost('/api/erc8183-jobs/web-hire/created', {
    prepareId,
    createTxHash: txHash,
  }, cookie);

  console.log(`[created] status=${createdRes.status}`);
  console.log(`[created] body=${JSON.stringify(createdRes.data, null, 2)}`);

  const pass = createdRes.status === 422 && createdRes.data.error === 'event_expired_at_mismatch';

  return {
    pass,
    prepareId,
    prepExpiredAt,
    actualExpiredAt: differentExpiredAt.toString(),
    txHash,
    httpStatus: createdRes.status,
    error: createdRes.data.error,
    detail: createdRes.data.detail,
  };
}

// ── Test 2: hook mismatch ───────────────────────────────────────────────────

async function testHookMismatch(cookie: string) {
  console.log('\n═══ TEST 2: hook mismatch ═══\n');

  const nowUnix = Math.floor(Date.now() / 1000);
  const prepExpiredAt = String(nowUnix + 7200);

  console.log(`[prepare] Calling prepare...`);
  const prepRes = await apiPost('/api/erc8183-jobs/web-hire/prepare', {
    settlementMode: 'erc8183_escrow',
    buyerAgentId: '32179',
    providerAgentId: '32965',
    evaluatorAgentId: '32966',
    budgetAtomic: '100000',
    expiredAtUnix: prepExpiredAt,
    description: `${DESCRIPTION_PREFIX} Test2 hook mismatch ${Date.now()}`,
    inputPayload: { test: 'event_hook_validation' },
  }, cookie);

  console.log(`[prepare] status=${prepRes.status} ok=${prepRes.data.ok}`);
  if (!prepRes.data.ok) {
    console.error('[prepare] FAILED:', JSON.stringify(prepRes.data, null, 2));
    return { pass: false, error: 'prepare_failed', detail: prepRes.data.detail };
  }

  const prepareId = prepRes.data.prepareId;
  const prepNext = prepRes.data.next?.createJob;
  const prepHook = prepNext?.hook || '0x0000000000000000000000000000000000000000';
  const prepProvider = prepNext?.provider;
  const prepEvaluator = prepNext?.evaluator;
  const prepExpiredAtFromResult = prepNext?.expiredAt || prepExpiredAt;
  const description = prepNext?.description || `${DESCRIPTION_PREFIX} Test2`;

  console.log(`[prepare] prepareId=${prepareId}`);
  console.log(`[prepare] prep.hook=${prepHook}`);
  console.log(`[prepare] prep.expiredAt=${prepExpiredAtFromResult}`);

  // Use a DIFFERENT hook address (EVALUATOR_ADDR as valid non-zero address)
  const differentHook = EVALUATOR_ADDR;
  console.log(`\n[tx] Sending createJob with different hook=${differentHook}...`);

  const client = makeClient(CLIENT_PK);
  const txHash = await client.sendTransaction({
    to: AGENTIC_COMMERCE,
    data: encodeFunctionData({
      abi: CREATE_JOB_ABI,
      functionName: 'createJob',
      args: [
        prepProvider as Hex,
        prepEvaluator as Hex,
        BigInt(prepExpiredAtFromResult),
        description,
        differentHook as Hex,
      ],
    }),
  });

  console.log(`[tx] txHash=${txHash}`);
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
  console.log(`[tx] status=${receipt.status} block=${receipt.blockNumber}`);

  if (receipt.status !== 'success') {
    return { pass: false, error: 'tx_reverted', txHash, prepareId };
  }

  // Submit to /created — should reject
  console.log(`\n[created] Submitting mismatched txHash...`);
  const createdRes = await apiPost('/api/erc8183-jobs/web-hire/created', {
    prepareId,
    createTxHash: txHash,
  }, cookie);

  console.log(`[created] status=${createdRes.status}`);
  console.log(`[created] body=${JSON.stringify(createdRes.data, null, 2)}`);

  const pass = createdRes.status === 422 && createdRes.data.error === 'event_hook_mismatch';

  return {
    pass,
    prepareId,
    prepHook,
    actualHook: differentHook,
    txHash,
    httpStatus: createdRes.status,
    error: createdRes.data.error,
    detail: createdRes.data.detail,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  PR #410 Live Regression: Event Field Validation            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nTest wallets:`);
  console.log(`  CLIENT    = ${CLIENT_ADDR}`);
  console.log(`  WORKER    = ${WORKER_ADDR}`);
  console.log(`  EVALUATOR = ${EVALUATOR_ADDR}`);
  console.log(`Preview URL: ${BASE_URL}`);
  console.log(`Contract: ${AGENTIC_COMMERCE}`);

  // Authenticate
  const cookie = await authenticateWallet();

  const t1 = await testExpiredAtMismatch(cookie);
  console.log(`\n>>> TEST 1 RESULT: ${t1.pass ? '✅ PASS' : '❌ FAIL'}`);

  await sleep(3000);

  const t2 = await testHookMismatch(cookie);
  console.log(`\n>>> TEST 2 RESULT: ${t2.pass ? '✅ PASS' : '❌ FAIL'}`);

  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  FINAL REPORT                                               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\nCLIENT    = ${CLIENT_ADDR}`);
  console.log(`WORKER    = ${WORKER_ADDR}`);
  console.log(`EVALUATOR = ${EVALUATOR_ADDR}`);

  console.log(`\n--- Test 1: expiredAt mismatch ---`);
  console.log(`  prepareId        = ${t1.prepareId || 'N/A'}`);
  console.log(`  prep.expiredAt   = ${t1.prepExpiredAt || 'N/A'}`);
  console.log(`  actual.expiredAt = ${t1.actualExpiredAt || 'N/A'}`);
  console.log(`  txHash           = ${t1.txHash || 'N/A'}`);
  console.log(`  HTTP status      = ${t1.httpStatus || 'N/A'}`);
  console.log(`  error            = ${t1.error || 'N/A'}`);
  console.log(`  RESULT           = ${t1.pass ? '✅ PASS' : '❌ FAIL'}`);

  console.log(`\n--- Test 2: hook mismatch ---`);
  console.log(`  prepareId        = ${t2.prepareId || 'N/A'}`);
  console.log(`  prep.hook        = ${t2.prepHook || 'N/A'}`);
  console.log(`  actual.hook      = ${t2.actualHook || 'N/A'}`);
  console.log(`  txHash           = ${t2.txHash || 'N/A'}`);
  console.log(`  HTTP status      = ${t2.httpStatus || 'N/A'}`);
  console.log(`  error            = ${t2.error || 'N/A'}`);
  console.log(`  RESULT           = ${t2.pass ? '✅ PASS' : '❌ FAIL'}`);

  console.log(`\nOVERALL: ${t1.pass && t2.pass ? '✅ BOTH PASS — PR #410 P1 validation verified live' : '❌ SOME FAILED'}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
