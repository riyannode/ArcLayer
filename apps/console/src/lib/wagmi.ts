import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { arcTestnet } from '@arcwork/sdk';

export const config = createConfig({
  chains: [arcTestnet],
  connectors: [
    injected(),
  ],
  transports: {
    [arcTestnet.id]: http('https://rpc.testnet.arc.network'),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
