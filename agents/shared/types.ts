// Shared types for Pythia + Hermes agents

export interface TradingSignal {
  token: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number; // 0-100
  price: number;
  reasoning: string;
  timestamp: number;
}

export interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource: string;
  description: string;
}

export interface X402PaymentPayload {
  x402Version: number;
  scheme: 'exact';
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: `0x${string}`;
      to: `0x${string}`;
      value: bigint | string;
      validAfter: number;
      validBefore: number;
      nonce: string;
    };
  };
}

export interface TradeRecord {
  id: string;
  token: string;
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  signalConfidence: number;
  paymentTxHash: string;
  tradeTxHash?: string;
  timestamp: number;
  pnl?: number;
}

export interface AgentState {
  balance: bigint;
  trades: TradeRecord[];
  signalsPurchased: number;
  totalSpentOnSignals: bigint;
  totalPnl: number;
}
