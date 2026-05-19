'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { useCircleWallet } from '@/hooks/useCircleWallet';

/**
 * useX402Access — frontend gating hook.
 *
 * Checks sessionStorage for an active x402 payment session.
 * When `hasAccess` is false, action buttons should be disabled.
 *
 * The X402DemoPanel stores payment proof in sessionStorage as:
 *   key: `x402_paid:{rail}:/api/x402/protected-resource:{address}`
 *   value: JSON with { txHash }
 *
 * This hook checks both rails (arc-native, circle-gateway).
 */

const RESOURCE = '/api/x402/protected-resource';

export interface X402AccessState {
  /** Whether the user has an active paid session */
  hasAccess: boolean;
  /** The wallet address that paid */
  payer: string | null;
  /** The rail used for payment */
  rail: 'arc-native' | 'circle-gateway' | null;
  /** Transaction hash of the payment */
  txHash: string | null;
  /** Whether we're still checking (SSR guard) */
  loading: boolean;
}

export function useX402Access(): X402AccessState {
  const { address: eoaAddress, isConnected: eoaConnected } = useAccount();
  const { authenticated, address: circleAddress } = useCircleWallet();

  const activeAddress = useMemo(() => {
    if (eoaConnected && eoaAddress) return eoaAddress.toLowerCase();
    if (authenticated && circleAddress) return circleAddress.toLowerCase();
    return null;
  }, [eoaConnected, eoaAddress, authenticated, circleAddress]);

  const [state, setState] = useState<X402AccessState>({
    hasAccess: false,
    payer: null,
    rail: null,
    txHash: null,
    loading: true,
  });

  const check = useCallback(() => {
    if (typeof window === 'undefined' || !activeAddress) {
      setState({ hasAccess: false, payer: null, rail: null, txHash: null, loading: false });
      return;
    }

    // Check both rails
    const rails = ['arc-native', 'circle-gateway'] as const;
    for (const rail of rails) {
      const key = `x402_paid:${rail}:${RESOURCE}:${activeAddress}`;
      const stored = sessionStorage.getItem(key);
      if (stored) {
        let txHash: string | null = null;
        try {
          const parsed = JSON.parse(stored);
          txHash = parsed.txHash || null;
        } catch { /* ignore */ }
        setState({ hasAccess: true, payer: activeAddress, rail, txHash, loading: false });
        return;
      }
    }

    setState({ hasAccess: false, payer: activeAddress, rail: null, txHash: null, loading: false });
  }, [activeAddress]);

  // Check on mount and when address changes
  useEffect(() => {
    check();
  }, [check]);

  // Listen for storage events (in case payment happens in another tab/component)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => check();
    window.addEventListener('storage', handler);
    // Also listen for custom event dispatched by X402DemoPanel after payment
    window.addEventListener('x402:paid', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('x402:paid', handler);
    };
  }, [check]);

  return state;
}
