/**
 * Hermes - Autonomous Market Agent.
 * Buys Pythia x402 signals, then executes Ignia prediction-market trades on Arc.
 */

import * as dotenv from 'dotenv';
import { X402Client } from '../shared/x402-client.js';
import type { TradingSignal, AgentState } from '../shared/types.js';
import { buyIgniaShares, formatUsdc, getLatestMarketId, IgniaSide, readMarket } from '../shared/ignia.js';
import { PaperTrader } from './trader.js';

dotenv.config();

const PRIVATE_KEY = process.env.HERMES_PRIVATE_KEY as `0x${string}` | undefined;
const PYTHIA_URL = process.env.PYTHIA_URL ?? 'http://localhost:4001';
const TOKENS = (process.env.HERMES_TOKENS ?? 'BTC,ETH,SOL').split(',').map(s => s.trim().toUpperCase());
const INTERVAL_MS = Number(process.env.HERMES_INTERVAL_MS ?? 15000);
const MAX_ITERATIONS = Number(process.env.HERMES_MAX_ITERATIONS ?? 10);
const IGNIA_MARKET_ID = process.env.IGNIA_MARKET_ID ? BigInt(process.env.IGNIA_MARKET_ID) : undefined;
const IGNIA_TRADE_USDC = process.env.IGNIA_TRADE_USDC ?? '0.10';
const ENABLE_IGNIA_EXECUTION = process.env.ENABLE_IGNIA_EXECUTION !== 'false';
const MIN_IGNIA_CONFIDENCE = Number(process.env.MIN_IGNIA_CONFIDENCE ?? 60);

if (!PRIVATE_KEY) {
  console.error('Missing HERMES_PRIVATE_KEY in .env');
  console.error('Set HERMES_PRIVATE_KEY in agents/.env');
  process.exit(1);
}

const client = new X402Client(PRIVATE_KEY);
const trader = new PaperTrader(1000);

const state: AgentState = {
  balance: BigInt(0),
  trades: [],
  signalsPurchased: 0,
  totalSpentOnSignals: BigInt(0),
  totalPnl: 0,
};

async function buySignal(token: string): Promise<{ signal: TradingSignal; txHash?: string }> {
  const url = `${PYTHIA_URL}/signal/${token}`;
  console.log(`\n[Hermes] Requesting signal for ${token}`);
  const { data, paymentTxHash } = await client.payAndAccess<TradingSignal & { payment?: { txHash?: string } }>(url);
  return { signal: data, txHash: paymentTxHash ?? data.payment?.txHash };
}

function signalToIgniaSide(signal: TradingSignal): IgniaSide | null {
  if (signal.confidence < MIN_IGNIA_CONFIDENCE || signal.signal === 'HOLD') return null;
  return signal.signal === 'BUY' ? IgniaSide.YES : IgniaSide.NO;
}

async function executeIgniaTrade(signal: TradingSignal) {
  if (!ENABLE_IGNIA_EXECUTION) {
    console.log('[Hermes] Ignia execution disabled');
    return null;
  }

  const side = signalToIgniaSide(signal);
  if (side === null) {
    console.log(`[Hermes] Ignia skip · signal=${signal.signal} confidence=${signal.confidence}`);
    return null;
  }

  const marketId = IGNIA_MARKET_ID ?? await getLatestMarketId();
  const market = await readMarket(marketId);
  if (market.outcome !== 0) {
    console.log(`[Hermes] Ignia skip · market #${marketId} already resolved outcome=${market.outcome}`);
    return null;
  }

  console.log(`[Hermes] Ignia market #${marketId}: ${market.question}`);
  console.log(`[Hermes] Current YES probability: ${market.yesProbabilityBps.toFixed(2)}%`);
  console.log(`[Hermes] Executing ${side === IgniaSide.YES ? 'YES' : 'NO'} · size=${IGNIA_TRADE_USDC} USDC`);

  const result = await buyIgniaShares(PRIVATE_KEY!, marketId, side, IGNIA_TRADE_USDC);
  console.log(`[Hermes] Ignia trade tx: ${result.tradeTx}`);
  console.log(`[Hermes] Ignia shares quoted: ${formatUsdc(result.quotedShares)}`);
  if (result.approveTx) console.log(`[Hermes] USDC approve tx: ${result.approveTx}`);
  return result;
}

async function runIteration(i: number) {
  const token = TOKENS[i % TOKENS.length];

  try {
    const beforeBalance = await client.getBalance();
    const { signal, txHash } = await buySignal(token);
    const afterBalance = await client.getBalance();

    const spent = beforeBalance > afterBalance ? beforeBalance - afterBalance : BigInt(0);
    state.signalsPurchased += 1;
    state.totalSpentOnSignals += spent;
    state.balance = afterBalance;

    console.log(`[Hermes] Signal received: ${signal.token} ${signal.signal} confidence=${signal.confidence}`);
    console.log(`[Hermes] Reasoning: ${signal.reasoning}`);
    console.log(`[Hermes] Payment tx: ${txHash ?? 'pending'}`);

    const paperTrade = trader.executeSignal(signal, txHash ?? 'unknown');
    if (paperTrade) state.trades.push(paperTrade);

    await executeIgniaTrade(signal);

    console.log(`[Hermes] Portfolio:`, trader.summary());
    console.log(`[Hermes] USDC balance: ${(Number(afterBalance) / 1e6).toFixed(6)}`);
  } catch (err: any) {
    console.error(`[Hermes] Iteration failed:`, err.message ?? err);
  }
}

async function main() {
  console.log(`\n🪽 Hermes - Autonomous Market Agent`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Wallet: ${client.address}`);
  console.log(`Pythia: ${PYTHIA_URL}`);
  console.log(`Tokens: ${TOKENS.join(', ')}`);
  console.log(`Interval: ${INTERVAL_MS}ms`);
  console.log(`Max iterations: ${MAX_ITERATIONS}`);
  console.log(`Ignia execution: ${ENABLE_IGNIA_EXECUTION ? 'enabled' : 'disabled'}`);
  console.log(`Ignia market: ${IGNIA_MARKET_ID?.toString() ?? 'latest'}`);
  console.log(`Ignia trade size: ${IGNIA_TRADE_USDC} USDC`);

  state.balance = await client.getBalance();
  console.log(`USDC balance: ${(Number(state.balance) / 1e6).toFixed(6)}\n`);

  // MAX_ITERATIONS=0 means run forever (full autonomous mode)
  const infinite = MAX_ITERATIONS === 0;
  let i = 0;
  while (infinite || i < MAX_ITERATIONS) {
    await runIteration(i);
    i++;
    if (infinite || i < MAX_ITERATIONS) await new Promise(r => setTimeout(r, INTERVAL_MS));
  }

  console.log(`\n[Hermes] Run complete`);
  console.log(`Signals purchased: ${state.signalsPurchased}`);
  console.log(`Paper trades executed: ${state.trades.length}`);
  console.log(`Total signal spend: ${(Number(state.totalSpentOnSignals) / 1e6).toFixed(6)} USDC`);
  console.log(`Final portfolio:`, trader.summary());
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
