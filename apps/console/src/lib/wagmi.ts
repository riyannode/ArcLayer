import { http, fallback, createConfig } from 'wagmi';
import { ARC_RPC_URLS, arcTestnet } from '@arclayer/sdk';

/**
 * Read-only wagmi config retained for @wagmi/core helpers.
 *
 * Circle Modular Wallets handles auth + writes via ERC-4337 bundler.
 * This config is intentionally connector-free and only supports public
 * reads / transaction receipt polling against Arc Testnet RPCs.
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
