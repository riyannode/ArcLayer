'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { CircleWalletProvider } from '@/hooks/useCircleWallet';
import { config as wagmiConfig } from '@/lib/wagmi';
import { RailProvider } from '@/components/rail';

const queryClient = new QueryClient();

/**
 * Client-side providers tree.
 *
 * Dual auth mode:
 * - Circle Modular Wallets (ERC-4337 + passkey) — recommended UX
 * - EOA via Reown AppKit (MetaMask/WalletConnect/Coinbase) — Polymarket-style
 *
 * AppKit is initialized at module load in `@/lib/wagmi` (singleton pattern).
 * Both target Arc Testnet and the same x402 backend.
 *
 * RailProvider sits below wallet providers so routes can opt into x402 rail
 * selection at the final paid action. It must not render a global rail modal.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <CircleWalletProvider>
          <RailProvider>
            {children}
          </RailProvider>
        </CircleWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
