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
          logo: '/arclayer-logo-nav.png',
          showWalletLoginFirst: true,
          // Curated wallet list — 5 popular options.
          // 'detected_wallets' auto-surfaces any injected extension (OKX,
          // SubWallet, Trust, Phantom EVM, etc.) without opening the
          // WalletConnect 599-wallet directory.
          walletList: [
            'detected_wallets',
            'metamask',
            'rabby_wallet',
            'coinbase_wallet',
            'rainbow',
          ],
          walletChainType: 'ethereum-only',
        },
        externalWallets: {
          walletConnect: {
            enabled: false,
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
