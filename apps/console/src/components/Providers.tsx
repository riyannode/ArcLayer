'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { WagmiProvider } from '@privy-io/wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { arcTestnet } from '@arclayer/sdk';
import AutoSwitchArcChain from './AutoSwitchArcChain';
import { config } from '@/lib/wagmi';

const queryClient = new QueryClient();

// Privy App ID — injected at build time via NEXT_PUBLIC_PRIVY_APP_ID.
// Falls back to hardcoded testing ID if env missing (not production-safe).
const PRIVY_APP_ID =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'cmopoaivr00kw0cl7pl9m3noz';

/**
 * Client-side providers tree. Order matters:
 *   PrivyProvider → WagmiProvider (Privy's) → QueryClientProvider
 *
 * This gives us:
 * - External wallet connect (top-popular: MetaMask, Coinbase, Rabby,
 *   Phantom, Rainbow, OKX) + WalletConnect for mobile
 * - Email login (embedded wallets auto-provisioned for non-crypto users)
 * - Full wagmi hooks compatibility in downstream components
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['wallet', 'email'],
        appearance: {
          theme: 'dark',
          accentColor: '#C5A67C',
          logo: '/arc-brand.svg',
          showWalletLoginFirst: true,
          // Curated top-popular wallet list. Explicitly NOT using
          // `detected_ethereum_wallets` because it auto-enumerates every
          // installed EIP-6963 provider (SubWallet, Frame, Brave, etc.)
          // cluttering the modal. Named IDs keep the list short and
          // recognizable. Privy v2 resolves named IDs via RDNS-first
          // EIP-6963, so clicking "MetaMask" routes to the real MetaMask
          // provider when installed, not window.ethereum.
          //
          // `wallet_connect` stays for mobile + desktop wallets not in
          // the curated list.
          walletList: [
            'metamask',
            'coinbase_wallet',
            'rabby_wallet',
            'phantom',
            'rainbow',
            'okx_wallet',
            'wallet_connect',
          ],
          walletChainType: 'ethereum-only',
        },
        externalWallets: {
          walletConnect: {
            enabled: true,
          },
        },
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          <AutoSwitchArcChain />
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
