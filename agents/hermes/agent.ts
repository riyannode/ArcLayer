/**
 * Hermes - Autonomous Market Agent.
 * Buys trading signals from Pythia using x402, then trades based on them.
 */

import * as dotenv from 'dotenv';
import { X402Client } from '../shared/x402-client.js';
import type { TradingSignal, AgentState } from '../shared/types.js';
import { PaperTrader } from './trader.js';

dotenv.config();

const PRIVATE_KEY = process.env.HERMES_PRIVATE_KEY as `0x${string}` | undefined;
const PYTHIA_URL = process.env.PYTHIA_URL ?? 'http://localhost:4001';
const TOKENS = (process.env.HERMES_TOKENS ?? 'BTC,ETH,SOL').split(',').map(s => s.trim().toUpperCase());
const INTERVAL_MS = Number(process.env.HERMES_INTERVAL_MS ?? 15000);
const MAX_ITERATIONS = Number(process.env.HERMES_MAX_ITERATIONS ?? 10);

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

    const trade = trader.executeSignal(signal, txHash ?? 'unknown');
    if (trade) {
      state.trades.push(trade);
    }

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

  state.balance = await client.getBalance();
  console.log(`USDC balance: ${(Number(state.balance) / 1e6).toFixed(6)}\n`);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    await runIteration(i);
    if (i < MAX_ITERATIONS - 1) {
      await new Promise(r => setTimeout(r, INTERVAL_MS));
    }
  }

  console.log(`\n[Hermes] Run complete`);
  console.log(`Signals purchased: ${state.signalsPurchased}`);
  console.log(`Trades executed: ${state.trades.length}`);
  console.log(`Total signal spend: ${(Number(state.totalSpentOnSignals) / 1e6).toFixed(6)} USDC`);
  console.log(`Final portfolio:`, trader.summary());
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
