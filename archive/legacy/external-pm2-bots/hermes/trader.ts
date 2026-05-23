/**
 * Hermes prediction-market paper trading engine.
 *
 * This is NOT a spot trader. Spot BTC/ETH price is only reference data.
 * Hermes buys binary UP/DOWN outcome shares for 5m prediction markets.
 *
 * Dual-balance model:
 *   - x402Balance: funds reserved for paying Pythia/Apolo x402 fees
 *   - tradeBalance: funds used for mock prediction-market trades
 *
 * Trade size is fixed (default $0.01).
 */

import type { TradingSignal, TradeRecord } from '../shared/types.js';

export interface PredictionPosition {
  shares: number;
  avgContractPrice: number;
  notional: number;
  direction: 'UP' | 'DOWN';
  referencePrice: number;
}

export interface Portfolio {
  x402Balance: number;
  tradeBalance: number;
  positions: Record<string, PredictionPosition>;
  trades: TradeRecord[];
}

export class PaperTrader {
  portfolio: Portfolio;
  tradeSize: number;

  constructor(x402Balance = 500, tradeBalance = 500, tradeSize = 0.01) {
    this.portfolio = { x402Balance, tradeBalance, positions: {}, trades: [] };
    this.tradeSize = tradeSize;
  }

  deductX402Fee(amountUsdc: number): boolean {
    if (this.portfolio.x402Balance < amountUsdc) return false;
    this.portfolio.x402Balance -= amountUsdc;
    return true;
  }

  executeSignal(signal: TradingSignal, paymentTxHash: string): TradeRecord | null {
    if (signal.confidence < 25 || signal.signal === 'HOLD') {
      console.log(`[Hermes] HOLD · ${signal.token} 5m prediction market · confidence=${signal.confidence}`);
      return null;
    }

    if (this.portfolio.tradeBalance < this.tradeSize) {
      console.log(`[Hermes] prediction trade skip · insufficient tradeBalance (${this.portfolio.tradeBalance.toFixed(4)})`);
      return null;
    }

    const direction = signal.signal === 'BUY' ? 'UP' : 'DOWN';
    const market = `${signal.token}-5M-${direction}`;
    const contractPrice = this.estimateContractPrice(signal.confidence);
    const shares = this.tradeSize / contractPrice;

    this.portfolio.tradeBalance -= this.tradeSize;

    const pos = this.portfolio.positions[market] ?? {
      shares: 0,
      avgContractPrice: contractPrice,
      notional: 0,
      direction,
      referencePrice: signal.price,
    };
    const newNotional = pos.notional + this.tradeSize;
    const newShares = pos.shares + shares;
    this.portfolio.positions[market] = {
      shares: newShares,
      avgContractPrice: newNotional / newShares,
      notional: newNotional,
      direction,
      referencePrice: signal.price,
    };

    const side = signal.signal === 'BUY' ? 'BUY' : 'SELL';
    const trade = this.recordTrade(signal, side, shares, contractPrice, market, direction, paymentTxHash);

    console.log(
      `[Hermes] PREDICTION ${direction} · market=${market} · size=$${this.tradeSize.toFixed(2)} · ` +
      `shares=${shares.toFixed(4)} · contract=$${contractPrice.toFixed(4)} · ` +
      `refSpot=$${signal.price.toFixed(2)} · conf=${signal.confidence} · x402=${paymentTxHash}`
    );

    return trade;
  }

  private estimateContractPrice(confidence: number): number {
    const c = Math.max(25, Math.min(95, confidence));
    return Number((0.5 + (c / 100) * 0.45).toFixed(4));
  }

  private recordTrade(
    signal: TradingSignal,
    side: 'BUY' | 'SELL',
    shares: number,
    contractPrice: number,
    market: string,
    direction: 'UP' | 'DOWN',
    paymentTxHash: string,
  ): TradeRecord {
    const trade: TradeRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      token: market,
      side,
      price: contractPrice,
      amount: shares,
      signalConfidence: signal.confidence,
      paymentTxHash,
      timestamp: Date.now(),
    };
    (trade as any).marketType = 'prediction-market';
    (trade as any).underlying = signal.token;
    (trade as any).direction = direction;
    (trade as any).referencePrice = signal.price;
    (trade as any).notionalUsdc = this.tradeSize;

    this.portfolio.trades.push(trade);
    return trade;
  }

  markToMarket(_latestPrices: Record<string, number>): number {
    let equity = this.portfolio.tradeBalance + this.portfolio.x402Balance;
    for (const pos of Object.values(this.portfolio.positions)) {
      equity += pos.shares * pos.avgContractPrice;
    }
    return equity;
  }

  summary() {
    return {
      marketType: 'prediction-market',
      x402Balance: Number(this.portfolio.x402Balance.toFixed(4)),
      tradeBalance: Number(this.portfolio.tradeBalance.toFixed(4)),
      positions: this.portfolio.positions,
      trades: this.portfolio.trades.length,
      lastTrade: this.portfolio.trades.at(-1) ?? null,
    };
  }
}
