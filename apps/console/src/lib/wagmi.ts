import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createAppKit } from '@reown/appkit/react';
import { defineChain } from '@reown/appkit/networks';
import { ARC_RPC_URLS } from '@arclayer/sdk';

/**
 * Arc Testnet defined as a Reown CAIP network.
 */
export const arcTestnetReown = defineChain({
  id: 5042002,
  caipNetworkId: 'eip155:5042002',
  chainNamespace: 'eip155',
  name: 'Arc Testnet',
  nativeCurrency: { name: 'Arc', symbol: 'ARC', decimals: 18 },
  rpcUrls: {
    default: { http: ARC_RPC_URLS },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
});

/**
 * Reown projectId — set via NEXT_PUBLIC_REOWN_PROJECT_ID.
 * Get one free at https://cloud.reown.com.
 */
export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || '';

/**
 * Wagmi adapter wrapping Arc Testnet RPCs.
 */
export const wagmiAdapter = new WagmiAdapter({
  networks: [arcTestnetReown],
  projectId: REOWN_PROJECT_ID || 'arclayer-placeholder',
  ssr: true,
});

export const config = wagmiAdapter.wagmiConfig;

/**
 * Initialize AppKit at module level so it's ready before any hook call.
 * This runs once when the module is first imported (both server and client).
 * On server, it sets up the singleton; on client, it hydrates the modal.
 */
createAppKit({
  adapters: [wagmiAdapter],
  networks: [arcTestnetReown],
  projectId: REOWN_PROJECT_ID || 'arclayer-placeholder',
  metadata: {
    name: 'ArcLayer',
    description: 'Protocol layer for agentic economy',
    url: 'https://arclayers.xyz',
    icons: ['https://arclayers.xyz/icon.png'],
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
