import { http, fallback, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { ARC_RPC_URLS, arcTestnet } from '@arcwork/sdk';

export const config = createConfig({
  chains: [arcTestnet],
  connectors: [
    injected(),
  ],
  transports: {
    [arcTestnet.id]: fallback(ARC_RPC_URLS.map((url) => http(url))),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
