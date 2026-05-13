'use client';

import { useEffect, useRef } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { arcTestnet } from '@arclayer/sdk';

const ARC_TESTNET_CAIP_CHAIN_ID = `eip155:${arcTestnet.id}`;

export default function AutoSwitchArcChain() {
  const { ready: privyReady } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const switchingWallets = useRef(new Set<string>());

  useEffect(() => {
    if (!privyReady || !walletsReady || wallets.length === 0) return;

    // Fire as soon as a wallet is connected — BEFORE Privy's SIWE sign prompt.
    // `authenticated` flips true only after the user signs, which is too late:
    // the sign itself happens on whatever chain the wallet is currently on.
    wallets.forEach((wallet) => {
      if (wallet.type !== 'ethereum') return;
      if (wallet.chainId === ARC_TESTNET_CAIP_CHAIN_ID) return;
      if (switchingWallets.current.has(wallet.address)) return;

      switchingWallets.current.add(wallet.address);
      wallet
        .switchChain(arcTestnet.id)
        .catch((error) => {
          console.warn('Unable to auto-switch wallet to Arc Testnet', error);
        })
        .finally(() => {
          switchingWallets.current.delete(wallet.address);
        });
    });
  }, [privyReady, walletsReady, wallets]);

  return null;
}
