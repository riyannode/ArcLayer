"use client";

import { useAppKit } from '@reown/appkit/react';
import { useAccount } from 'wagmi';

export function useArcWallet() {
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();

  return {
    address,
    isConnected,
    openConnect: () => open(),
  };
}
