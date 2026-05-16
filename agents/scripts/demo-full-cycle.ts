/**
 * ArcLayer Full Cycle Demo Orchestrator
 * ======================================
 * Demonstrates the complete 7-step autonomous agent economy cycle:
 *
 *   1. CAPABILITY  — Discover agents on-chain (AgentRegistry)
 *   2. PAYMENT     — Buy x402 signal from Pythia (EIP-3009 USDC)
 *   3. EXECUTION   — Execute Ignia prediction market trade
 *   4. VERIFICATION — Resolve market via Pythia oracle
 *   5. SETTLEMENT  — Claim winnings from Ignia
 *   6. PROOF       — Anchor receipt on-chain (EIP-712 signed)
 *   7. REPUTATION  — Record signal + trader outcomes on-chain
 *
 * Uses Pythia wallet (has oracle authority + gas + USDC).
 * Creates a short-lived Ignia market so it can resolve immediately.
 */

import * as dotenv from 'dotenv';
import {
  createWalletClient,
  http,
  keccak256,
  toBytes,
  encodePacked,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { X402Client } from '../shared/x402-client.js';
import {
  IGNIA_ADDRESS,
  IGNIA_ABI,
  ERC20_ABI,
  USDC_ADDRESS,
  USDC_DECIMALS,
  IgniaSide,
  IgniaOutcome,
  publicClient,
  createIgniaWallet,
  readMarket,
  ensureUsdcAllowance,
  buyIgniaShares,
  resolveIgniaMarket,
  formatUsdc,
  getLatestMarketId,
} from '../shared/ignia.js';
import { arcTestnet } from '../shared/x402-client.js';
import {
  getAgent,
  getAgentsByRole,
  AgentRole,
  Rail,
  anchorReceipt,
  recordInteraction,
  recordSignalOutcome,
  recordTraderOutcome,
  getReputation,
  getStats,
  type ReceiptStruct,
} from '../contracts/a2a-client.js';
import { A2A_CONTRACTS, ARC_TESTNET } from '../contracts/addresses.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentIds = JSON.parse(
  readFileSync(join(__dirname, '../contracts/agent-ids.json'), 'utf-8')
) as { pythia: { agentId: string }; hermes: { agentId: string } };

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────
const PYTHIA_KEY = process.env.PYTHIA_ORACLE_PRIVATE_KEY as `0x${string}`;
const HERMES_KEY = process.env.HERMES_PRIVATE_KEY as `0x${string}`;
const PYTHIA_URL = process.env.PYTHIA_URL ?? 'http://localhost:4001';

if (!PYTHIA_KEY) { console.error('Missing PYTHIA_ORACLE_PRIVATE_KEY'); process.exit(1); }
if (!HERMES_KEY) { console.error('Missing HERMES_PRIVATE_KEY'); process.exit(1); }

const pythiaAccount = privateKeyToAccount(PYTHIA_KEY);
const hermesAccount = privateKeyToAccount(HERMES_KEY);

const PYTHIA_AGENT_ID = agentIds.pythia.agentId as `0x${string}`;
const HERMES_AGENT_ID = agentIds.hermes.agentId as `0x${string}`;

// claimWinnings ABI (not in shared/ignia.ts)
const CLAIM_ABI = [
  { type: 'function', name: 'claimWinnings', inputs: [{ type: 'uint256', name: 'marketId' }], outputs: [{ type: 'uint256', name: 'payout' }], stateMutability: 'nonpayable' },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`\n[${'━'.repeat(60)}]`);
  console.log(`[STEP ${step}] ${msg}`);
  console.log(`[${'━'.repeat(60)}]`);
}

function sublog(msg: string) {
  console.log(`  → ${msg}`);
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// EIP-712 receipt signing (provider signs the receipt)
const RECEIPT_DOMAIN = {
  name: 'ArcLayerA2AReceipt',
  version: '1',
  chainId: ARC_TESTNET.chainId,
  verifyingContract: A2A_CONTRACTS.A2AReceiptRegistry as Address,
} as const;

const RECEIPT_TYPES = {
  Receipt: [
    { name: 'providerAgentId', type: 'bytes32' },
    { name: 'buyerAgentId', type: 'bytes32' },
    { name: 'amount', type: 'uint128' },
    { name: 'paymentRef', type: 'bytes32' },
    { name: 'requestHash', type: 'bytes32' },
    { name: 'responseHash', type: 'bytes32' },
    { name: 'signalHash', type: 'bytes32' },
    { name: 'timestamp', type: 'uint64' },
  ],
} as const;

async function signReceipt(receipt: {
  providerAgentId: `0x${string}`;
  buyerAgentId: `0x${string}`;
  amount: bigint;
  paymentRef: `0x${string}`;
  requestHash: `0x${string}`;
  responseHash: `0x${string}`;
  signalHash: `0x${string}`;
  timestamp: bigint;
}): Promise<`0x${string}`> {
  const pythiaWallet = createWalletClient({
    account: pythiaAccount,
    chain: arcTestnet,
    transport: http(ARC_TESTNET.rpc),
  });

  return pythiaWallet.signTypedData({
    account: pythiaAccount,
    domain: RECEIPT_DOMAIN,
    types: RECEIPT_TYPES,
    primaryType: 'Receipt',
    message: receipt,
  });
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ArcLayer — Full Autonomous Agent Economy Cycle`);
  console.log(`  7-Step Demo Orchestrator`);
  console.log(`${'═'.repeat(64)}`);
  console.log(`  Pythia (Oracle):  ${pythiaAccount.address}`);
  console.log(`  Hermes (Trader):  ${hermesAccount.address}`);
  console.log(`  Network:          Arc Testnet (${ARC_TESTNET.chainId})`);
  console.log(`${'═'.repeat(64)}\n`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: CAPABILITY — Discover agents on-chain
  // ═══════════════════════════════════════════════════════════════════════════
  log('1/7', 'CAPABILITY — Discovering agents on-chain');

  const pythiaInfo = await getAgent(PYTHIA_AGENT_ID);
  sublog(`Pythia agent: ${PYTHIA_AGENT_ID.slice(0, 18)}...`);
  sublog(`  Role: MARKET_DATA (${pythiaInfo[1]}), Active: ${pythiaInfo[4]}`);
  sublog(`  Endpoint: ${pythiaInfo[2]}`);

  const hermesInfo = await getAgent(HERMES_AGENT_ID);
  sublog(`Hermes agent: ${HERMES_AGENT_ID.slice(0, 18)}...`);
  sublog(`  Role: TRADER (${hermesInfo[1]}), Active: ${hermesInfo[4]}`);

  const oracleAgents = await getAgentsByRole(AgentRole.ORACLE);
  sublog(`Oracle agents on-chain: ${oracleAgents.length}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: PAYMENT — Buy x402 signal from Pythia
  // ═══════════════════════════════════════════════════════════════════════════
  log('2/7', 'PAYMENT — Buying x402 signal from Pythia (EIP-3009 USDC)');

  // Use Pythia wallet for demo payment as the funded execution wallet.
  // The on-chain receipt still records Hermes as the buyer agent.
  const x402Client = new X402Client(PYTHIA_KEY);
  const balanceBefore = await x402Client.getBalance();
  sublog(`Execution wallet USDC balance: ${formatUsdc(balanceBefore)}`);

  const token = 'BTC';
  sublog(`Requesting signal for ${token} from ${PYTHIA_URL}/signal/${token}`);

  const { data: signal, paymentTxHash } = await x402Client.payAndAccess<any>(`${PYTHIA_URL}/signal/${token}`);

  const balanceAfter = await x402Client.getBalance();
  const spent = balanceBefore > balanceAfter ? balanceBefore - balanceAfter : 0n;

  sublog(`Signal received: ${signal.token} ${signal.signal} confidence=${signal.confidence}`);
  sublog(`Reasoning: ${signal.reasoning}`);
  sublog(`Payment tx: ${paymentTxHash ?? signal.payment?.txHash ?? 'settled'}`);
  sublog(`Cost: ${formatUsdc(spent)}`);

  const paymentTx = (paymentTxHash ?? signal.payment?.txHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`;

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: EXECUTION — Create short-lived Ignia market + trade
  // ═══════════════════════════════════════════════════════════════════════════
  log('3/7', 'EXECUTION — Creating Ignia market + executing trade');

  // Create a market with 90-second deadline (so we can resolve quickly)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 90);
  const question = `BTC > ${signal.price ?? 100000} in 90s (demo)`;
  const seedUsdc = 100000n; // 0.1 USDC seed

  sublog(`Creating market: "${question}"`);
  sublog(`Deadline: ${new Date(Number(deadline) * 1000).toISOString()}`);

  // Approve USDC for Ignia (seed + trade)
  await ensureUsdcAllowance(PYTHIA_KEY, seedUsdc + 100000n);

  const { account: pythiaAcc, wallet: pythiaWallet } = createIgniaWallet(PYTHIA_KEY);
  const createTx = await pythiaWallet.writeContract({
    address: IGNIA_ADDRESS,
    abi: IGNIA_ABI,
    functionName: 'createMarket',
    args: [question, deadline, seedUsdc],
    account: pythiaAcc,
    chain: arcTestnet,
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTx, timeout: 300_000, pollingInterval: 2_000 });
  sublog(`Market created tx: ${createTx}`);

  // Get the new market ID
  const marketId = await getLatestMarketId();
  const market = await readMarket(marketId);
  sublog(`Market #${marketId}: ${market.question}`);
  sublog(`YES probability: ${(market.yesProbabilityBps * 100).toFixed(1)}%`);

  // Execute trade (Hermes buys YES based on signal)
  const side = signal.signal === 'SELL' ? IgniaSide.NO : IgniaSide.YES;
  const tradeAmount = '0.05'; // 0.05 USDC
  sublog(`Hermes trading ${side === IgniaSide.YES ? 'YES' : 'NO'} · ${tradeAmount} USDC`);

  // Use Pythia wallet for trade too (Hermes may be low on gas)
  await ensureUsdcAllowance(PYTHIA_KEY, 50000n);
  const tradeResult = await buyIgniaShares(PYTHIA_KEY, marketId, side, tradeAmount);
  sublog(`Trade tx: ${tradeResult.tradeTx}`);
  sublog(`Shares received: ${tradeResult.quotedShares.toString()}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: VERIFICATION — Wait for deadline, then resolve via Pythia oracle
  // ═══════════════════════════════════════════════════════════════════════════
  log('4/7', 'VERIFICATION — Waiting for deadline, then resolving market');

  const nowSec = Math.floor(Date.now() / 1000);
  const waitSec = Number(deadline) - nowSec + 2; // +2s buffer
  if (waitSec > 0) {
    sublog(`Waiting ${waitSec}s for deadline to pass...`);
    await sleep(waitSec * 1000);
  }

  // Resolve: always YES for demo (we bought YES)
  const resolveOutcome = IgniaOutcome.YES;
  sublog(`Resolving market #${marketId} → YES`);
  const resolveResult = await resolveIgniaMarket(PYTHIA_KEY, marketId, resolveOutcome);
  sublog(`Resolve tx: ${resolveResult.txHash}`);

  // Verify resolution
  const resolvedMarket = await readMarket(marketId);
  sublog(`Market outcome: ${resolvedMarket.outcome === 1 ? 'YES' : resolvedMarket.outcome === 2 ? 'NO' : 'UNRESOLVED'}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: SETTLEMENT — Claim winnings from Ignia
  // ═══════════════════════════════════════════════════════════════════════════
  log('5/7', 'SETTLEMENT — Claiming winnings from Ignia');

  const claimTx = await pythiaWallet.writeContract({
    address: IGNIA_ADDRESS,
    abi: CLAIM_ABI,
    functionName: 'claimWinnings',
    args: [marketId],
    account: pythiaAcc,
    chain: arcTestnet,
  });
  const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimTx, timeout: 300_000, pollingInterval: 2_000 });
  sublog(`Claim tx: ${claimTx}`);
  sublog(`Status: ${claimReceipt.status === 'success' ? '✓ Winnings claimed' : '✗ Failed'}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: PROOF — Anchor receipt on-chain (EIP-712 signed by Pythia)
  // ═══════════════════════════════════════════════════════════════════════════
  log('6/7', 'PROOF — Anchoring receipt on-chain (A2AReceiptRegistry)');

  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const requestHash = keccak256(toBytes(`signal:${token}:${timestamp}`));
  const responseHash = keccak256(toBytes(JSON.stringify(signal).slice(0, 200)));
  const signalHash = keccak256(toBytes(`${signal.token}:${signal.signal}:${signal.confidence}:${signal.price}`));
  const receiptHash = keccak256(
    encodePacked(
      ['bytes32', 'bytes32', 'bytes32', 'bytes32', 'uint128', 'uint64'],
      [PYTHIA_AGENT_ID, HERMES_AGENT_ID, requestHash, responseHash, 10000n, timestamp]
    )
  );

  // Sign receipt as Pythia (provider)
  const receiptMsg = {
    providerAgentId: PYTHIA_AGENT_ID,
    buyerAgentId: HERMES_AGENT_ID,
    amount: 10000n, // 0.01 USDC in atomic
    paymentRef: paymentTx as `0x${string}`,
    requestHash,
    responseHash,
    signalHash,
    timestamp,
  };

  sublog(`Signing receipt (EIP-712) as Pythia...`);
  const providerSig = await signReceipt(receiptMsg);
  sublog(`Signature: ${providerSig.slice(0, 20)}...`);

  // Build receipt struct
  const receiptStruct: ReceiptStruct = {
    providerAgentId: PYTHIA_AGENT_ID,
    buyerAgentId: HERMES_AGENT_ID,
    receiptHash,
    requestHash,
    responseHash,
    signalHash,
    amount: 10000n,
    timestamp,
    rail: Rail.ARC_NATIVE,
    paymentRef: paymentTx as `0x${string}`,
    tradeTx: tradeResult.tradeTx as `0x${string}`,
    provider: pythiaAccount.address,
    exists: false,
  };

  sublog(`Anchoring receipt on-chain...`);
  const anchorTx = await anchorReceipt(PYTHIA_KEY, receiptStruct, providerSig);
  sublog(`Anchor tx: ${anchorTx}`);
  await publicClient.waitForTransactionReceipt({ hash: anchorTx, timeout: 300_000, pollingInterval: 2_000 });
  sublog(`Receipt anchored ✓`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: REPUTATION — Record outcomes on-chain
  // ═══════════════════════════════════════════════════════════════════════════
  log('7/7', 'REPUTATION — Recording outcomes on-chain');

  // Record interaction (Pythia served Hermes)
  sublog(`Recording interaction...`);
  const interactionTx = await recordInteraction(PYTHIA_KEY, PYTHIA_AGENT_ID, HERMES_AGENT_ID, receiptHash, 10000n, true);
  sublog(`Interaction tx: ${interactionTx}`);

  // Record signal outcome (signal was correct — we won)
  sublog(`Recording signal outcome (correct=true, pnl=+500bps)...`);
  const signalTx = await recordSignalOutcome(PYTHIA_KEY, PYTHIA_AGENT_ID, receiptHash, true, 500n, BigInt(signal.confidence));
  sublog(`Signal outcome tx: ${signalTx}`);

  // Record trader outcome (Hermes executed successfully)
  sublog(`Recording trader outcome (pnl=+500bps, executed=true)...`);
  const traderTx = await recordTraderOutcome(PYTHIA_KEY, HERMES_AGENT_ID, receiptHash, 500n, true, true);
  sublog(`Trader outcome tx: ${traderTx}`);

  // Final reputation check
  await sleep(3000); // wait for tx confirmations
  const pythiaRep = await getReputation(PYTHIA_AGENT_ID);
  const hermesRep = await getReputation(HERMES_AGENT_ID);
  const pythiaStats = await getStats(PYTHIA_AGENT_ID);
  const hermesStats = await getStats(HERMES_AGENT_ID);

  sublog(`Pythia reputation: ${pythiaRep.toString()}`);
  sublog(`Hermes reputation: ${hermesRep.toString()}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  ✅ FULL CYCLE COMPLETE — All 7 Steps Executed`);
  console.log(`${'═'.repeat(64)}`);
  console.log(`
  1. CAPABILITY   — Agents discovered on AgentRegistry
  2. PAYMENT      — x402 signal purchased (${formatUsdc(spent)})
     tx: ${paymentTx}
  3. EXECUTION    — Ignia market #${marketId} trade (${tradeAmount} USDC ${side === IgniaSide.YES ? 'YES' : 'NO'})
     tx: ${tradeResult.tradeTx}
  4. VERIFICATION — Market resolved → YES by Pythia oracle
     tx: ${resolveResult.txHash}
  5. SETTLEMENT   — Winnings claimed
     tx: ${claimTx}
  6. PROOF        — Receipt anchored (EIP-712 signed)
     tx: ${anchorTx}
  7. REPUTATION   — Outcomes recorded on-chain
     Pythia score: ${pythiaRep.toString()}
     Hermes score: ${hermesRep.toString()}
`);
  console.log(`${'═'.repeat(64)}\n`);
}

main().catch(err => {
  console.error('\n❌ Demo failed:', err.message ?? err);
  if (err.cause) console.error('Cause:', err.cause);
  process.exit(1);
});
