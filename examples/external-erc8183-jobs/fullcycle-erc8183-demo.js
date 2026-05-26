/**
 * Full ERC-8183 escrow demo — on-chain job lifecycle.
 *
 * Flow: createJob(on-chain) → setBudget(on-chain) → approve+fund(on-chain)
 *       → claim(off-chain metadata) → running(off-chain metadata)
 *       → submit(on-chain) → complete(on-chain).
 *
 * Routes return tx instructions. User signs+broadcasts via their wallet.
 * No private key in this script — no server-side signing.
 *
 * Usage:
 *   node fullcycle-erc8183-demo.js
 *
 * Each step prints the tx instruction. Copy it to your wallet (e.g. Foundry cast,
 * Viem, or Arc console wallet), sign+broadcast, then the script continues after
 * you provide the tx hash.
 */
require('dotenv').config();
const {
  createErc8183Job,
  confirmCreateTx,
  setBudget,
  fund,
  confirmTx,
  claimErc8183Job,
  markErc8183Running,
  submitErc8183Job,
  completeErc8183Job,
} = require('./shared/erc8183-job-client');

const BUYER_AGENT_ID = process.env.BUYER_AGENT_ID || 'agent_buyer_001';
const PROVIDER_AGENT_ID = process.env.PROVIDER_AGENT_ID || 'agent_provider_001';
const EVALUATOR_AGENT_ID = process.env.EVALUATOR_AGENT_ID || 'agent_evaluator_001';

// P0.9: Fail fast on invalid addresses — no placeholder defaults
function requiredAddress(name) {
  const value = process.env[name];
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`\n${name} must be a valid 0x address.\nSet ${name}=<address> in .env or export it.\n`);
  }
  return value;
}
const CLIENT_ADDRESS = requiredAddress('CLIENT_ADDRESS');
const PROVIDER_ADDRESS = requiredAddress('PROVIDER_ADDRESS');
const EVALUATOR_ADDRESS = requiredAddress('EVALUATOR_ADDRESS');

const ARCLAYER_BASE_URL = process.env.ARCLAYER_BASE_URL || 'http://localhost:3000';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Prompt user for a tx hash, return it. */
function promptTxHash(stepLabel) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`\n${stepLabel}\nSign and broadcast the tx above, then paste the tx hash (0x...): `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('=== Full ERC-8183 Escrow Demo ===');
  console.log('ArcLayer /api/erc8183-jobs/*        settlement_mode=erc8183_escrow');
  console.log('Arc native x402:   /api/agent-jobs/* settlement_mode=x402_offchain');
  console.log();
  console.log(`ArcLayer URL: ${ARCLAYER_BASE_URL}`);
  console.log();

  // ── Step 1: Create local job ──────────────────────────────────────
  console.log('1. Creating local ERC-8183 job...');
  const created = await createErc8183Job({
    buyerAgentId: BUYER_AGENT_ID,
    clientAddress: CLIENT_ADDRESS,
    providerAgentId: PROVIDER_AGENT_ID,
    providerAddress: PROVIDER_ADDRESS,
    evaluatorAgentId: EVALUATOR_AGENT_ID,
    evaluatorAddress: EVALUATOR_ADDRESS,
    expiredAtUnix: String(Math.floor(Date.now() / 1000) + 86400), // 24h
    description: 'ERC-8183 demo job',
    budgetAtomic: '1000000', // 1 USDC (6 decimals)
    inputPayload: { query: 'Demo ERC-8183 escrow job' },
  });
  const localJobId = created.localJobId;
  console.log(`   Local job created: ${localJobId}`);
  console.log(`   Next action: ${created.nextAction}`);
  console.log();
  console.log('   TX to broadcast (AgenticCommerce.createJob):');
  console.log(`     Contract:  ${created.tx.address}`);
  console.log(`     Function:  ${created.tx.functionName}`);
  console.log(`     Args:      ${JSON.stringify(created.tx.args)}`);
  console.log();

  // ── Step 2: Confirm createJob tx ──────────────────────────────────
  const createTxHash = await promptTxHash('Step 2 — confirm createJob');
  console.log(`\n   Confirming createJob tx: ${createTxHash}`);
  await sleep(2000);
  const confirmed = await confirmCreateTx(localJobId, createTxHash);
  const erc8183JobId = confirmed.erc8183JobId;
  console.log(`   createJob confirmed! erc8183_job_id: ${erc8183JobId}`);
  console.log(`   erc8183_status: ${confirmed.erc8183Status}`);
  console.log(`   blockNumber: ${confirmed.blockNumber}`);
  console.log();

  // ── Step 3: Set budget ────────────────────────────────────────────
  console.log('3. Getting setBudget tx instruction...');
  const budgetTx = await setBudget(localJobId);
  console.log('   TX to broadcast (AgenticCommerce.setBudget):');
  console.log(`     Contract:  ${budgetTx.tx.address}`);
  console.log(`     Function:  ${budgetTx.tx.functionName}`);
  console.log(`     Args:      ${JSON.stringify(budgetTx.tx.args)}`);
  console.log();

  const setBudgetTxHash = await promptTxHash('Step 3b — broadcast setBudget');
  console.log(`\n   Confirming setBudget tx: ${setBudgetTxHash}`);
  await sleep(2000);
  const budgetConfirmed = await confirmTx(localJobId, 'set_budget', setBudgetTxHash);
  console.log(`   setBudget confirmed! status: ${budgetConfirmed.erc8183Status}`);
  console.log();

  // ── Step 4: Approve USDC + fund escrow ────────────────────────────
  console.log('4. Getting approve + fund tx instructions...');
  const fundTx = await fund(localJobId);
  console.log('   TX 1 — USDC.approve (sign first):');
  console.log(`     Contract:  ${fundTx.txs[0].address}`);
  console.log(`     Function:  ${fundTx.txs[0].functionName}`);
  console.log(`     Args:      ${JSON.stringify(fundTx.txs[0].args)}`);
  console.log();
  console.log('   TX 2 — AgenticCommerce.fund (sign after approve confirms):');
  console.log(`     Contract:  ${fundTx.txs[1].address}`);
  console.log(`     Function:  ${fundTx.txs[1].functionName}`);
  console.log(`     Args:      ${JSON.stringify(fundTx.txs[1].args)}`);
  console.log();

  const fundTxHash = await promptTxHash('Step 4b — broadcast approve + fund, then paste fund tx hash');
  console.log(`\n   Confirming fund tx: ${fundTxHash}`);
  await sleep(2000);
  const fundConfirmed = await confirmTx(localJobId, 'fund', fundTxHash);
  console.log(`   Fund confirmed! erc8183_status: ${fundConfirmed.erc8183Status}`);
  console.log();

  // ── Step 5: Off-chain claim ───────────────────────────────────────
  console.log('5. Off-chain worker claim (no tx — metadata only)...');
  const claimed = await claimErc8183Job(localJobId, {
    workerId: 'agent_worker_001',
    providerAgentId: PROVIDER_AGENT_ID,
    claimTtlSeconds: 600,
  });
  console.log(`   Claimed: status=${claimed.status}, workerId=${claimed.workerId}`);
  console.log();

  // ── Step 6: Off-chain running ─────────────────────────────────────
  console.log('6. Off-chain running (no tx — metadata only)...');
  const running = await markErc8183Running(localJobId, 'agent_worker_001');
  console.log(`   Running: status=${running.status}`);
  console.log();

  // ── Step 7: Submit deliverable ────────────────────────────────────
  console.log('7. Submitting deliverable...');
  await sleep(500);
  const submitted = await submitErc8183Job(localJobId, {
    workerId: 'agent_worker_001',
    resultPayload: {
      analysis: 'bullish',
      confidence: 0.91,
      processedAt: new Date().toISOString(),
    },
    proofPayload: {
      runtime: 'pm2',
      durationMs: 1200,
      model: 'deepseek-v4-flash',
    },
  });
  console.log(`   deliverableHash: ${submitted.deliverableHash}`);
  console.log('   TX to broadcast (AgenticCommerce.submit):');
  console.log(`     Contract:  ${submitted.tx.address}`);
  console.log(`     Function:  ${submitted.tx.functionName}`);
  console.log(`     Args:      ${JSON.stringify(submitted.tx.args)}`);
  console.log();

  const submitTxHash = await promptTxHash('Step 7b — broadcast submit');
  console.log(`\n   Confirming submit tx: ${submitTxHash}`);
  await sleep(2000);
  const submitConfirmed = await confirmTx(localJobId, 'submit', submitTxHash);
  console.log(`   Submit confirmed! erc8183_status: ${submitConfirmed.erc8183Status}`);
  console.log();

  // ── Step 8: Complete escrow settlement ────────────────────────────
  console.log('8. Completing escrow settlement...');
  const completed = await completeErc8183Job(localJobId, {
    evaluatorAgentId: EVALUATOR_AGENT_ID,
    approved: true,
    reason: 'deliverable-approved',
  });
  console.log('   TX to broadcast (AgenticCommerce.complete):');
  console.log(`     Contract:  ${completed.tx.address}`);
  console.log(`     Function:  ${completed.tx.functionName}`);
  console.log(`     Args:      ${JSON.stringify(completed.tx.args)}`);
  console.log();

  const completeTxHash = await promptTxHash('Step 8b — broadcast complete');
  console.log(`\n   Confirming complete tx: ${completeTxHash}`);
  await sleep(2000);
  const completeConfirmed = await confirmTx(localJobId, 'complete', completeTxHash);
  console.log(`   Complete confirmed! erc8183_status: ${completeConfirmed.erc8183Status}`);
  console.log();

  // ── Done ──────────────────────────────────────────────────────────
  console.log('=== Full ERC-8183 escrow cycle complete ===');
  console.log(`localJobId:     ${localJobId}`);
  console.log(`erc8183JobId:   ${erc8183JobId}`);
  console.log(`final status:   ${completeConfirmed.erc8183Status || completeConfirmed.status}`);
  console.log();
  console.log('Settlement is on-chain ERC-8183 escrow via AgenticCommerce.complete().');
  console.log('x402 off-chain settlement is separate — see examples/external-agent-jobs/.');
}

main().catch((err) => {
  console.error('\nDemo failed:', err.message);
  process.exit(1);
});
