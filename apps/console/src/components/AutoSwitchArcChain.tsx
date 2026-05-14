'use client';

import { useEffect, useRef } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { arcTestnet } from '@arclayer/sdk';

const ARC_TESTNET_CAIP_CHAIN_ID = `eip155:${arcTestnet.id}`;
const ARC_HEX_CHAIN_ID = `0x${arcTestnet.id.toString(16)}`;
// EIP-3085 add-chain payload — used as fallback when switchChain() returns
// the "Unrecognized chain ID" error (code 4902 in MetaMask, varies elsewhere).
const ARC_ADD_CHAIN_PARAMS = {
  chainId: ARC_HEX_CHAIN_ID,
  chainName: arcTestnet.name,
  nativeCurrency: arcTestnet.nativeCurrency,
  rpcUrls: arcTestnet.rpcUrls.default.http,
  blockExplorerUrls: arcTestnet.blockExplorers?.default
    ? [arcTestnet.blockExplorers.default.url]
    : [],
};

function isUnrecognizedChainError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: number; message?: string };
  // MetaMask: 4902. Others stringify the message — match defensively.
  if (e.code === 4902) return true;
  const msg = (e.message ?? '').toLowerCase();
  return (
    msg.includes('unrecognized chain') ||
    msg.includes('chain not added') ||
    msg.includes('try adding the chain') ||
    msg.includes('chain id') && msg.includes('not')
  );
}

export default function AutoSwitchArcChain() {
  const { ready: privyReady } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const switchingWallets = useRef(new Set<string>());

  useEffect(() => {
    if (!privyReady || !walletsReady || wallets.length === 0) return;

    // Fire as soon as a wallet is connected — BEFORE Privy's SIWE sign prompt.
    // `authenticated` flips true only after the user signs, which is too late:
    // the sign itself happens on whatever chain the wallet is currently on.
    wallets.forEach(async (wallet) => {
      if (wallet.type !== 'ethereum') return;
      if (wallet.chainId === ARC_TESTNET_CAIP_CHAIN_ID) return;
      if (switchingWallets.current.has(wallet.address)) return;

      switchingWallets.current.add(wallet.address);
      try {
        // Step 1: try plain switchChain. Works if the wallet already knows
        // about Arc (either pre-added by user, or previously injected via
        // wallet_addEthereumChain in this browser session).
        await wallet.switchChain(arcTestnet.id);
      } catch (switchErr) {
        // Step 2: fallback to EIP-3085 add-chain via the EIP-1193 provider
        // directly. Privy's wallet.switchChain doesn't auto-add. For non-MM
        // wallets ("Utama", Bitget, etc.) this is the only path that works
        // when the chain isn't pre-loaded.
        if (!isUnrecognizedChainError(switchErr)) {
          console.warn('Unable to switch wallet to Arc Testnet', switchErr);
          return;
        }
        try {
          const provider = await wallet.getEthereumProvider();
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [ARC_ADD_CHAIN_PARAMS],
          });
          // Some wallets switch automatically after add; some don't. Re-call
          // switchChain to be safe — it's idempotent if already on Arc.
          await wallet.switchChain(arcTestnet.id).catch(() => {});
        } catch (addErr) {
          console.warn('Unable to add Arc Testnet to wallet', addErr);
        }
      } finally {
        switchingWallets.current.delete(wallet.address);
      }
    });
  }, [privyReady, walletsReady, wallets]);

  return null;
}
