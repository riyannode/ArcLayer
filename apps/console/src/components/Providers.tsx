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
          // Curated short list. Three buttons cover ~95% of EVM users:
          // MetaMask (desktop majority), Coinbase Wallet (mainstream/onboarding),
          // and WalletConnect (mobile + everything else via QR).
          //
          // Dropped from earlier list:
          //  - rabby      → power-user niche, available via WC
          //  - phantom    → Solana-first, EVM rarely the primary use
          //  - rainbow    → small share, available via WC
          //  - okx_wallet → known to hijack window.ethereum on this stack
          //
          // Note: clicking "Other wallet" expands WalletConnect's directory
          // (~300 wallets). That list is owned by WC, not us — we cannot
          // truncate it without removing WalletConnect entirely.
          walletList: [
            'metamask',
            'coinbase_wallet',
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
