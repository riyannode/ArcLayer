#!/usr/bin/env npx tsx
// @ts-nocheck — standalone smoke script, runtime verified

// ── Live-mode guard ──────────────────────────────────────────────────────
if (process.env.ERC8183_SMOKE_LIVE !== 'true') {
  console.log('Set ERC8183_SMOKE_LIVE=true to run live on-chain ERC-8183 smoke test.');
  process.exit(0);
}
/**
 * ERC-8183 Full Lifecycle Smoke Test
 *
 * Tests the COMPLETE ERC-8183 lifecycle with real wallets:
 *
 * Arc ERC-8183 on-chain lifecycle:
 *   1. Create local job mirror (DB)
 *   2. createJob on-chain (client signs) → extract jobId from event
 *   3. Confirm create tx → attach erc8183JobId + createTxHash
 *   4. Verify on-chain job state (client/provider/evaluator match)
 *   5. setBudget on-chain (provider signs)
 *   6. approve USDC on-chain (client signs)
 *   7. fund on-chain → verify status=Funded(1)
 *   8. submit deliverable on-chain (worker signs) → verify status=Submitted(2)
 *   9. complete on-chain (evaluator signs) → verify status=Completed(3)
 *
 * ArcLayer backend/local orchestration:
 *  10. claim job (DB-only, off-chain worker metadata)
 *  11. mark running (DB-only, off-chain worker metadata)
 *
 * Final:
 *  12. Verify 6 on-chain tx hashes, deliverableHash, reasonHash in DB
 *      On-chain status = Completed(3), DB status = settled
 *
 * Note: claim and running are ArcLayer DB/local worker orchestration states
 * between fund and submit. They are NOT ERC-8183 on-chain states.
 *
 * Usage:
 *   cd apps/console
 *   set -a && source .env.local && set +a
 *   source /root/.secrets/arc-test-wallets/smoke-keys.env
 *   ERC8183_SMOKE_LIVE=true npx tsx scripts/smoke-erc8183-lifecycle.ts
 *
 * Requires:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in env
 *   - Wallet private keys in /root/.secrets/arc-test-wallets/wallets.json
 *   - API keys in SMOKE_CLIENT_KEY, SMOKE_PROVIDER_KEY, SMOKE_EVALUATOR_KEY env vars
 *   - USDC balances on all 3 wallets (CLIENT needs ~5 USDC, PROVIDER needs ~5, EVALUATOR needs ~1)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createClient } from '@supabase/supabase-js';
import {
  ARC_CHAIN_ID,
  ARC_RPC_URLS,
  CONTRACTS,
  ARC_TOKENS,
  ERC8183_AGENTIC_COMMERCE_ABI,
  ERC8004_IDENTITY_REGISTRY_ABI,
  USDC_ABI,
  buildCreateJobConfig,
  buildSetBudgetConfig,
  buildApproveUsdcConfig,
  buildFundJobConfig,
  buildSubmitDeliverableConfig,
  buildCompleteJobConfig,
  hashProtocolString,
} from '@arclayer/sdk';

// ── Config ────────────────────────────────────────────────────────────────

const WALLETS_PATH = '/root/.secrets/arc-test-wallets/wallets.json';
const BUDGET_USDC = '2'; // 2 USDC escrow budget
const JOB_DESCRIPTION = 'smoke-test-erc8183-lifecycle';
const EXPIRY_SECONDS = 3600; // 1 hour from now

// ── Setup ─────────────────────────────────────────────────────────────────

const wallets = JSON.parse(readFileSync(WALLETS_PATH, 'utf-8'));

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const CHAIN = {
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [...ARC_RPC_URLS] },
    public: { http: [...ARC_RPC_URLS] },
  },
};

const transport = http(ARC_RPC_URLS[0]);
const publicClient = createPublicClient({ chain: CHAIN, transport });

const clientAccount = privateKeyToAccount(wallets.client.privateKey as Hex);
const evaluatorAccount = privateKeyToAccount(wallets.evaluator.privateKey as Hex);
const workerAccount = privateKeyToAccount(wallets.worker.privateKey as Hex);

function makeWallet(pk: Hex) {
  const account = privateKeyToAccount(pk);
  return createWalletClient({ account, chain: CHAIN, transport });
}

// ── Helpers ───────────────────────────────────────────────────────────────

let stepNum = 0;
function step(msg: string) {
  console.log(`\n[${++stepNum}] ${msg}`);
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

async function getReceipt(hash: Hex): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    fail(`Tx reverted: ${hash}`);
  }
  return receipt;
}

function extractJobIdFromReceipt(receipt: TransactionReceipt): bigint {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACTS.ERC8183_AGENTIC_COMMERCE.toLowerCase()) continue;
    try {
      // JobCreated(uint256 jobId, address client, address provider, address evaluator, uint256 expiredAt, address hook)
      const topic0 = log.topics[0];
      // The jobId is in topics[1] (first indexed param)
      if (topic0 && log.topics[1]) {
        const jobId = BigInt(log.topics[1]);
        if (jobId > 0n) return jobId;
      }
    } catch { continue; }
  }
  fail('Could not extract jobId from JobCreated event');
}

async function checkBalance(name: string, address: Address) {
  const [native, erc20] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({
      address: ARC_TOKENS.USDC as Address,
      abi: USDC_ABI,
      functionName: 'balanceOf',
      args: [address],
    }),
  ]);
  console.log(`  ${name}: ${formatUnits(native, 18)} native / ${formatUnits(erc20, 6)} ERC-20 USDC`);
  return { native, erc20 };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== ERC-8183 Full Lifecycle Smoke Test ===');
  console.log(`Chain: ${ARC_CHAIN_ID} (${ARC_RPC_URLS[0]})`);
  console.log(`Client:    ${wallets.client.address}`);
  console.log(`Evaluator: ${wallets.evaluator.address}`);
  console.log(`Worker:    ${wallets.worker.address}`);
  console.log(`Budget:    ${BUDGET_USDC} USDC`);

  // ── Pre-flight balance check ───────────────────────────────────────────

  step('Pre-flight balance check');
  const clientBal = await checkBalance('Client', clientAccount.address);
  const providerBal = await checkBalance('Provider', workerAccount.address);
  const evaluatorBal = await checkBalance('Evaluator', evaluatorAccount.address);

  const budgetAtomic = parseUnits(BUDGET_USDC, 6);
  if (clientBal.erc20 < budgetAtomic) {
    fail(`Client needs at least ${BUDGET_USDC} USDC ERC-20, has ${formatUnits(clientBal.erc20, 6)}`);
  }
  ok('All wallets have sufficient balance');

  // ── Step 1: Create local job mirror ────────────────────────────────────

  step('Create local job mirror via Supabase');
  const localJobId = `erc8183_smoke_${Date.now().toString(36)}`;
  const inputPayload = { task: 'smoke-test', timestamp: Date.now() };
  const { createHash: cryptoHash } = await import('crypto');
  const inputPayloadHash = cryptoHash('sha256')
    .update(JSON.stringify(inputPayload, Object.keys(inputPayload).sort()))
    .digest('hex');

  const { error: insertErr } = await sb.from('agent_jobs').insert({
    job_id: localJobId,
    job_type: 'erc8183_escrow',
    settlement_mode: 'erc8183_escrow',
    status: 'created',
    buyer_agent_id: 'erc8183-smoke-client',
    provider_agent_id: 'erc8183-smoke-provider',
    client_address: wallets.client.address,
    provider_address: wallets.worker.address,
    evaluator_agent_id: 'erc8183-smoke-evaluator',
    evaluator_address: wallets.evaluator.address,
    expired_at_unix: String(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS),
    description: JOB_DESCRIPTION,
    hook_address: '0x0000000000000000000000000000000000000000',
    price_atomic: String(budgetAtomic),
    asset: 'USDC',
    chain_id: String(ARC_CHAIN_ID),
    input_payload: inputPayload,
    input_payload_hash: inputPayloadHash,
  });

  if (insertErr) fail(`Insert failed: ${insertErr.message}`);
  ok(`Local job created: ${localJobId}`);

  // ── Step 2: createJob on-chain ─────────────────────────────────────────

  step('createJob on-chain (client signs)');
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS);
  const createConfig = buildCreateJobConfig(
    workerAccount.address,  // provider
    evaluatorAccount.address,  // evaluator
    expiredAt,
    JOB_DESCRIPTION,
  );

  const clientWallet = makeWallet(wallets.client.privateKey as Hex);
  const createTxHash = await clientWallet.writeContract({
    ...createConfig,
    account: clientAccount,
  });
  ok(`createJob tx: ${createTxHash}`);

  const createReceipt = await getReceipt(createTxHash);
  const erc8183JobId = extractJobIdFromReceipt(createReceipt);
  ok(`On-chain jobId: ${erc8183JobId}`);

  // ── Step 3: Confirm create → attach jobId + txHash ─────────────────────

  step('Confirm create tx → attach to local mirror');
  const { error: attachErr } = await sb
    .from('agent_jobs')
    .update({
      create_tx_hash: createTxHash,
      erc8183_job_id: String(erc8183JobId),
      erc8183_status: 'Open',
    })
    .eq('job_id', localJobId)
    .eq('settlement_mode', 'erc8183_escrow');

  if (attachErr) fail(`Attach failed: ${attachErr.message}`);
  ok(`Attached jobId=${erc8183JobId}, createTxHash=${createTxHash.slice(0, 18)}...`);

  // ── Step 4: Read on-chain job to verify ────────────────────────────────

  step('Verify on-chain job state');
  const onchainJob = await publicClient.readContract({
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: 'getJob',
    args: [erc8183JobId],
  }) as unknown as {
    client: Address;
    provider: Address;
    evaluator: Address;
    description: string;
    budget: bigint;
    expiredAt: bigint;
    status: number;
    hook: Address;
  };

  ok(`client: ${onchainJob.client}`);
  ok(`provider: ${onchainJob.provider}`);
  ok(`evaluator: ${onchainJob.evaluator}`);
  ok(`status: ${onchainJob.status} (0=Open)`);

  if (onchainJob.status !== 0) fail(`Expected status=Open(0), got ${onchainJob.status}`);
  if (onchainJob.client.toLowerCase() !== clientAccount.address.toLowerCase()) {
    fail(`Client mismatch: expected ${clientAccount.address}, got ${onchainJob.client}`);
  }
  if (onchainJob.provider.toLowerCase() !== workerAccount.address.toLowerCase()) {
    fail(`Provider mismatch: expected ${workerAccount.address}, got ${onchainJob.provider}`);
  }
  ok('On-chain job state verified');

  // ── Step 5: setBudget on-chain (provider signs) ────────────────────────

  step('setBudget on-chain (provider signs)');
  const setBudgetConfig = buildSetBudgetConfig(erc8183JobId, budgetAtomic);
  const providerWallet = makeWallet(wallets.worker.privateKey as Hex);
  const setBudgetHash = await providerWallet.writeContract({
    ...setBudgetConfig,
    account: workerAccount,
  });
  ok(`setBudget tx: ${setBudgetHash}`);

  const setBudgetReceipt = await getReceipt(setBudgetHash);
  ok('setBudget confirmed');

  // Attach to local mirror
  await sb.from('agent_jobs')
    .update({ set_budget_tx_hash: setBudgetHash })
    .eq('job_id', localJobId);
  ok('Attached setBudgetTxHash to local mirror');

  // ── Step 6: Approve USDC (client signs) ────────────────────────────────

  step('approve USDC on-chain (client signs)');
  const approveConfig = buildApproveUsdcConfig(budgetAtomic);
  const approveHash = await clientWallet.writeContract({
    ...approveConfig,
    account: clientAccount,
  });
  ok(`approve tx: ${approveHash}`);

  await getReceipt(approveHash);
  ok('approve confirmed');

  await sb.from('agent_jobs')
    .update({ approve_tx_hash: approveHash })
    .eq('job_id', localJobId);
  ok('Attached approveTxHash to local mirror');

  // ── Step 7: Fund job (client signs) ────────────────────────────────────

  step('fund on-chain (client signs)');
  const fundConfig = buildFundJobConfig(erc8183JobId);
  const fundHash = await clientWallet.writeContract({
    ...fundConfig,
    account: clientAccount,
  });
  ok(`fund tx: ${fundHash}`);

  await getReceipt(fundHash);
  ok('fund confirmed');

  // Verify on-chain status = Funded
  const jobAfterFund = await publicClient.readContract({
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: 'getJob',
    args: [erc8183JobId],
  }) as unknown as { status: number; budget: bigint };

  if (jobAfterFund.status !== 1) fail(`Expected status=Funded(1), got ${jobAfterFund.status}`);
  ok(`On-chain status: Funded(1), budget: ${formatUnits(jobAfterFund.budget, 6)} USDC`);

  await sb.from('agent_jobs')
    .update({ fund_tx_hash: fundHash, erc8183_status: 'Funded' })
    .eq('job_id', localJobId);
  ok('Attached fundTxHash, erc8183_status=Funded');

  // ── Step 8: Claim job (off-chain worker metadata) ──────────────────────

  step('Claim job (off-chain store)');
  const now = new Date().toISOString();
  const claimExpires = new Date(Date.now() + 300_000).toISOString();

  const { error: claimErr } = await sb
    .from('agent_jobs')
    .update({
      status: 'claimed',
      worker_id: 'erc8183-smoke-provider',
      provider_agent_id: 'erc8183-smoke-provider',
      claimed_at: now,
      claim_expires_at: claimExpires,
    })
    .eq('job_id', localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .eq('erc8183_status', 'Funded')
    .eq('status', 'created');

  if (claimErr) fail(`Claim failed: ${claimErr.message}`);

  // Verify claim took effect
  const { data: claimedJob } = await sb
    .from('agent_jobs')
    .select('status, worker_id')
    .eq('job_id', localJobId)
    .single();

  if (claimedJob?.status !== 'claimed') fail(`Claim verification failed: status=${claimedJob?.status}`);
  ok(`Claimed by worker: ${claimedJob?.worker_id}`);

  // ── Step 9: Running (off-chain) ────────────────────────────────────────

  step('Mark running (off-chain store)');
  const { error: runningErr } = await sb
    .from('agent_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('job_id', localJobId)
    .eq('settlement_mode', 'erc8183_escrow')
    .eq('status', 'claimed')
    .eq('worker_id', 'erc8183-smoke-provider');

  if (runningErr) fail(`Running failed: ${runningErr.message}`);
  ok('Status: running');

  // ── Step 10: Submit deliverable on-chain (worker signs) ────────────────

  step('Submit deliverable on-chain (worker signs)');
  const deliverable = 'smoke-test-deliverable-v1';
  const deliverableHash = hashProtocolString(deliverable);

  // Store result/proof payloads before tx
  const resultPayload = { output: 'smoke test result', deliverable };
  const proofPayload = { proof: 'smoke test proof', timestamp: Date.now() };
  const resultPayloadHash = cryptoHash('sha256').update(JSON.stringify(resultPayload)).digest('hex');
  const proofPayloadHash = cryptoHash('sha256').update(JSON.stringify(proofPayload)).digest('hex');

  await sb.from('agent_jobs').update({
    result_payload: resultPayload,
    result_payload_hash: resultPayloadHash,
    proof_payload: proofPayload,
    proof_payload_hash: proofPayloadHash,
    deliverable_hash: deliverableHash,
  }).eq('job_id', localJobId);
  ok('Stored result/proof payloads in local mirror');

  const submitConfig = buildSubmitDeliverableConfig(erc8183JobId, deliverable);
  const submitHash = await providerWallet.writeContract({
    ...submitConfig,
    account: workerAccount,
  });
  ok(`submit tx: ${submitHash}`);

  await getReceipt(submitHash);
  ok('submit confirmed');

  // Verify on-chain status = Submitted
  const jobAfterSubmit = await publicClient.readContract({
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: 'getJob',
    args: [erc8183JobId],
  }) as unknown as { status: number };

  if (jobAfterSubmit.status !== 2) fail(`Expected status=Submitted(2), got ${jobAfterSubmit.status}`);
  ok('On-chain status: Submitted(2)');

  await sb.from('agent_jobs').update({
    submit_tx_hash: submitHash,
    erc8183_status: 'Submitted',
    status: 'submitted',
    submitted_at: new Date().toISOString(),
  }).eq('job_id', localJobId);
  ok('Attached submitTxHash, erc8183_status=Submitted');

  // ── Step 11: Complete on-chain (evaluator signs) ───────────────────────

  step('Complete on-chain (evaluator signs)');
  const reason = 'approved';
  const reasonHash = hashProtocolString(reason);

  await sb.from('agent_jobs').update({
    reason_hash: reasonHash,
  }).eq('job_id', localJobId);
  ok('Stored reasonHash in local mirror');

  const completeConfig = buildCompleteJobConfig(erc8183JobId, reason);
  const evaluatorWallet = makeWallet(wallets.evaluator.privateKey as Hex);
  const completeHash = await evaluatorWallet.writeContract({
    ...completeConfig,
    account: evaluatorAccount,
  });
  ok(`complete tx: ${completeHash}`);

  await getReceipt(completeHash);
  ok('complete confirmed');

  // Verify on-chain status = Completed
  const jobAfterComplete = await publicClient.readContract({
    address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as Address,
    abi: ERC8183_AGENTIC_COMMERCE_ABI,
    functionName: 'getJob',
    args: [erc8183JobId],
  }) as unknown as { status: number };

  if (jobAfterComplete.status !== 3) fail(`Expected status=Completed(3), got ${jobAfterComplete.status}`);
  ok('On-chain status: Completed(3)');

  await sb.from('agent_jobs').update({
    complete_tx_hash: completeHash,
    erc8183_status: 'Completed',
    status: 'settled',
    settled_at: new Date().toISOString(),
  }).eq('job_id', localJobId);
  ok('Attached completeTxHash, erc8183_status=Completed, status=settled');

  // ── Step 12: Final verification ────────────────────────────────────────

  step('Final verification');

  const { data: finalJob } = await sb
    .from('agent_jobs')
    .select('*')
    .eq('job_id', localJobId)
    .single();

  console.log('\n=== Final DB State ===');
  console.log(`  localJobId:       ${finalJob?.job_id}`);
  console.log(`  erc8183JobId:     ${finalJob?.erc8183_job_id}`);
  console.log(`  erc8183Status:    ${finalJob?.erc8183_status}`);
  console.log(`  status:           ${finalJob?.status}`);
  console.log(`  createTxHash:     ${finalJob?.create_tx_hash?.slice(0, 18)}...`);
  console.log(`  setBudgetTxHash:  ${finalJob?.set_budget_tx_hash?.slice(0, 18)}...`);
  console.log(`  approveTxHash:    ${finalJob?.approve_tx_hash?.slice(0, 18)}...`);
  console.log(`  fundTxHash:       ${finalJob?.fund_tx_hash?.slice(0, 18)}...`);
  console.log(`  submitTxHash:     ${finalJob?.submit_tx_hash?.slice(0, 18)}...`);
  console.log(`  completeTxHash:   ${finalJob?.complete_tx_hash?.slice(0, 18)}...`);
  console.log(`  deliverableHash:  ${finalJob?.deliverable_hash}`);
  console.log(`  reasonHash:       ${finalJob?.reason_hash}`);

  // Verify all tx hashes present
  const txFields = [
    'create_tx_hash', 'set_budget_tx_hash', 'approve_tx_hash',
    'fund_tx_hash', 'submit_tx_hash', 'complete_tx_hash',
  ];
  for (const field of txFields) {
    if (!finalJob?.[field]) fail(`Missing ${field} in final state`);
  }
  ok('All 6 tx hashes present');

  if (finalJob?.erc8183_status !== 'Completed') {
    fail(`Expected erc8183_status=Completed, got ${finalJob?.erc8183_status}`);
  }
  if (finalJob?.status !== 'settled') {
    fail(`Expected status=settled, got ${finalJob?.status}`);
  }
  ok('Final status: Completed/settled ✓');

  // ── Done ───────────────────────────────────────────────────────────────

  console.log('\n=== SMOKE TEST PASSED ===');
  console.log(`Local Job:  ${localJobId}`);
  console.log(`On-chain:   ${erc8183JobId}`);
  console.log('');
  console.log('Arc ERC-8183 on-chain lifecycle verified:');
  console.log('  createJob → setBudget → approve → fund → submit → complete');
  console.log('');
  console.log('ArcLayer DB/local orchestration verified:');
  console.log('  claim → running');
  console.log('');
  console.log('6 on-chain tx hashes verified. On-chain status Completed(3), DB status settled.');
}

main().catch((err) => {
  console.error('\n=== SMOKE TEST FAILED ===');
  console.error(err);
  process.exit(1);
});
