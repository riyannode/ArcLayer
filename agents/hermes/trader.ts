/**
 * Hermes paper trading engine.
 * 
 * Converts paid Pythia signals into simulated market positions.
 * Real DEX execution can be plugged in later; for hackathon demo,
 * the focus is agent-to-agent paid signal commerce settled on Arc.
 */

import type { TradingSignal, TradeRecord } from '../shared/types.js';

export interface Portfolio {
  cash: number;
  positions: Record<string, { amount: number; avgPrice: number }>;
  trades: TradeRecord[];
}

export class PaperTrader {
  portfolio: Portfolio;

  constructor(initialCash = 1000) {
    this.portfolio = { cash: initialCash, positions: {}, trades: [] };
  }

  executeSignal(signal: TradingSignal, paymentTxHash: string): TradeRecord | null {
    // Only trade high-conviction signals
    if (signal.confidence < 60 || signal.signal === 'HOLD') {
      console.log(`[Hermes] HOLD · ${signal.token} confidence=${signal.confidence}`);
      return null;
    }

    const allocationPct = Math.min(0.15, (signal.confidence - 50) / 300); // 3.3% - 15%
    const tradeValue = this.portfolio.cash * allocationPct;

    if (signal.signal === 'BUY') {
      if (tradeValue < 1) return null;
      const amount = tradeValue / signal.price;
      this.portfolio.cash -= tradeValue;
      const pos = this.portfolio.positions[signal.token] ?? { amount: 0, avgPrice: signal.price };
      const totalAmount = pos.amount + amount;
      const totalCost = pos.amount * pos.avgPrice + tradeValue;
      this.portfolio.positions[signal.token] = { amount: totalAmount, avgPrice: totalCost / totalAmount };

      const trade = this.recordTrade(signal, 'BUY', amount, paymentTxHash);
      console.log(`[Hermes] BUY · ${amount.toFixed(6)} ${signal.token} @ $${signal.price} · confidence=${signal.confidence}`);
      return trade;
    }

    if (signal.signal === 'SELL') {
      const pos = this.portfolio.positions[signal.token];
      if (!pos || pos.amount <= 0) {
        console.log(`[Hermes] SELL signal ignored · no ${signal.token} position`);
        return null;
      }

      const sellAmount = pos.amount * allocationPct;
      const proceeds = sellAmount * signal.price;
      this.portfolio.cash += proceeds;
      pos.amount -= sellAmount;
      if (pos.amount < 1e-9) delete this.portfolio.positions[signal.token];

      const trade = this.recordTrade(signal, 'SELL', sellAmount, paymentTxHash);
      console.log(`[Hermes] SELL · ${sellAmount.toFixed(6)} ${signal.token} @ $${signal.price} · confidence=${signal.confidence}`);
      return trade;
    }

    return null;
  }

  private recordTrade(signal: TradingSignal, side: 'BUY' | 'SELL', amount: number, paymentTxHash: string): TradeRecord {
    const trade: TradeRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      token: signal.token,
      side,
      price: signal.price,
      amount,
      signalConfidence: signal.confidence,
      paymentTxHash,
      timestamp: Date.now(),
    };
    this.portfolio.trades.push(trade);
    return trade;
  }

  markToMarket(latestPrices: Record<string, number>): number {
    let equity = this.portfolio.cash;
    for (const [token, pos] of Object.entries(this.portfolio.positions)) {
      equity += pos.amount * (latestPrices[token] ?? pos.avgPrice);
    }
    return equity;
  }

  summary() {
    return {
      cash: Number(this.portfolio.cash.toFixed(2)),
      positions: this.portfolio.positions,
      trades: this.portfolio.trades.length,
    };
  }
}
