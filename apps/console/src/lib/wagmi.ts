import { http, fallback } from 'wagmi';
import { createConfig } from '@privy-io/wagmi';
import { ARC_RPC_URLS, arcTestnet } from '@arclayer/sdk';

/**
 * wagmi config for Privy integration.
 *
 * Connectors are managed by Privy (social login, embedded wallets, external
 * wallets via WalletConnect/injected). We only declare chains + transports
 * here. All connector logic lives inside PrivyProvider.
 */
export const config = createConfig({
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: fallback(ARC_RPC_URLS.map((url) => http(url))),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
