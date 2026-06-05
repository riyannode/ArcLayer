'use client';

/**
 * Unified wallet state hook — EOA only.
 *
 * Owner Wallet is always the EOA address from wagmi/Reown.
 * Circle (passkey + smart account) is reserved for Agent Account;
 * it does NOT define the connected wallet or ownerAddress.
 *
 * Pages should consume this instead of useAccount/useCircleWallet directly:
 *
 *   const { isConnected, address, mode } = useArcWallet();
 *
 * Mode:
 *   - 'eoa'     → EOA wallet via Reown/wagmi, user pays gas
 *   - null      → disconnected (even if Circle is authenticated)
 */

import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useCircleWallet } from './useCircleWallet';
import type { Address } from 'viem';

export type WalletMode = 'eoa' | null;

export interface ArcWalletState {
  /** True if EOA is connected (Circle alone does not count) */
  isConnected: boolean;
  /** Active EOA address, '' when disconnected */
  address: Address | '';
  /** Always 'eoa' when connected. Circle does not set mode. */
  mode: WalletMode;
  /** True once wagmi has hydrated */
  ready: boolean;

  // ── Passkey internals (available for Agent Account flows, not owner wallet) ──
  smartAccount: ReturnType<typeof useCircleWallet>['smartAccount'];
  bundlerClient: ReturnType<typeof useCircleWallet>['bundlerClient'];
}

export function useArcWallet(): ArcWalletState {
  const {
    ready: circleReady,
    smartAccount,
    bundlerClient,
  } = useCircleWallet();
  const { address: eoaAddress, isConnected: eoaConnected } = useAccount();

  return useMemo<ArcWalletState>(() => {
    if (eoaConnected && eoaAddress) {
      return {
        isConnected: true,
        address: eoaAddress as Address,
        mode: 'eoa',
        ready: true,
        smartAccount,
        bundlerClient,
      };
    }
    return {
      isConnected: false,
      address: '',
      mode: null,
      ready: circleReady,
      smartAccount: null,
      bundlerClient: null,
    };
  }, [
    eoaConnected,
    eoaAddress,
    circleReady,
    smartAccount,
    bundlerClient,
  ]);
}
