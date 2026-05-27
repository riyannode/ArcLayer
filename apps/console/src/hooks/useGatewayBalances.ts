'use client';

import { useCallback, useEffect, useState } from 'react';
import { useArcWallet } from '@/hooks/useArcWallet';

export interface GatewayBalances {
  address: string;
  token: string;
  gatewayWallet: string;

  walletUsdc: string;
  walletAtomic: string;

  gatewayAvailableUsdc: string;
  gatewayAvailableAtomic: string;

  gatewayTotalUsdc: string;
  gatewayTotalAtomic: string;

  withdrawingUsdc: string;
  withdrawingAtomic: string;

  withdrawableUsdc: string;
  withdrawableAtomic: string;

  withdrawalBlock: string;
  withdrawalDelayBlocks: string;
  currentBlock: string;
  blocksRemaining: string;

  method: string;
}

export function useGatewayBalances() {
  const { address, isConnected } = useArcWallet();
  const [balances, setBalances] = useState<GatewayBalances | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isConnected || !address) {
      setBalances(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/x402/gateway-balance?address=${address}`, {
        cache: 'no-store',
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.detail || json?.error || 'Failed to read Gateway balance');
      }

      setBalances(json as GatewayBalances);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBalances(null);
    } finally {
      setLoading(false);
    }
  }, [address, isConnected]);

  useEffect(() => {
    refresh();

    if (!isConnected || !address) return;

    const timer = window.setInterval(refresh, 12_000);
    return () => window.clearInterval(timer);
  }, [address, isConnected, refresh]);

  return {
    balances,
    loading,
    error,
    refresh,
  };
}
