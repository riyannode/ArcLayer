import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createAppKit } from '@reown/appkit/react';
import { defineChain } from '@reown/appkit/networks';

export const arcTestnetReown = defineChain({
  id: 5042002,
  caipNetworkId: 'eip155:5042002',
  chainNamespace: 'eip155',
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL || 'https://testnet.arcscan.app' },
  },
  testnet: true,
});

export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || '';

export const wagmiAdapter = new WagmiAdapter({
  networks: [arcTestnetReown],
  projectId: REOWN_PROJECT_ID,
  ssr: true,
});

export const config = wagmiAdapter.wagmiConfig;

createAppKit({
  adapters: [wagmiAdapter],
  networks: [arcTestnetReown],
  projectId: REOWN_PROJECT_ID,
  metadata: {
    name: 'Arc x402 Agent Starter',
    description: 'Starter primitives for Arc x402 + agent commerce',
    url: 'https://www.arclayers.xyz/',
    icons: ['https://www.arclayers.xyz/favicon.ico'],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  themeMode: 'dark',
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
