'use client';

/**
 * Unified wallet state hook.
 *
 * Bridges Circle (passkey + smart account + bundler/paymaster) and
 * Reown/EOA (wagmi) into a single source of truth for the entire app.
 *
 * Pages should consume this instead of useCircleWallet/useAccount directly.
 *
 *   const { isConnected, address, mode } = useArcWallet();
 *
 * Mode tells downstream code which transport to use:
 *   - 'passkey' → Circle smart account, gasless via paymaster
 *   - 'eoa'     → EOA wallet via Reown/wagmi, user pays gas
 *   - null      → disconnected
 */

import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useCircleWallet } from './useCircleWallet';
import type { Address } from 'viem';

export type WalletMode = 'passkey' | 'eoa' | null;

export interface ArcWalletState {
  /** True if either passkey or EOA is connected */
  isConnected: boolean;
  /** Active address (Circle smart account or EOA), '' when disconnected */
  address: Address | '';
  /** Which transport is active. Drives write/sign routing. */
  mode: WalletMode;
  /** True once both providers have hydrated. */
  ready: boolean;

  // ── Passkey internals (only set when mode === 'passkey') ────────
  smartAccount: ReturnType<typeof useCircleWallet>['smartAccount'];
  bundlerClient: ReturnType<typeof useCircleWallet>['bundlerClient'];
}

export function useArcWallet(): ArcWalletState {
  const {
    ready,
    authenticated,
    address: circleAddress,
    smartAccount,
    bundlerClient,
  } = useCircleWallet();
  const { address: eoaAddress, isConnected: eoaConnected } = useAccount();

  return useMemo<ArcWalletState>(() => {
    // Prefer passkey when both are connected (it's gasless).
    if (authenticated && circleAddress) {
      return {
        isConnected: true,
        address: circleAddress,
        mode: 'passkey',
        ready,
        smartAccount,
        bundlerClient,
      };
    }
    if (eoaConnected && eoaAddress) {
      return {
        isConnected: true,
        address: eoaAddress as Address,
        mode: 'eoa',
        ready,
        smartAccount: null,
        bundlerClient: null,
      };
    }
    return {
      isConnected: false,
      address: '',
      mode: null,
      ready,
      smartAccount: null,
      bundlerClient: null,
    };
  }, [
    ready,
    authenticated,
    circleAddress,
    eoaConnected,
    eoaAddress,
    smartAccount,
    bundlerClient,
  ]);
}
