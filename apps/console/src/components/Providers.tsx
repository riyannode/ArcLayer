'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CircleWalletProvider } from '@/hooks/useCircleWallet';

const queryClient = new QueryClient();

/**
 * Client-side providers tree.
 *
 * ArcLayer uses Circle Modular Wallets (ERC-4337 smart accounts) with
 * passkey authentication. This gives us:
 * - Zero-friction onboarding (TouchID/FaceID, no extension required)
 * - Gasless transactions via Circle Gas Station paymaster
 * - Smart account features (batching, sponsored gas, social recovery)
 * - Native USDC settlement on Arc L1
 *
 * Replaces the previous Privy + wagmi stack for Hackathon scoring +
 * production-grade UX.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <CircleWalletProvider>{children}</CircleWalletProvider>
    </QueryClientProvider>
  );
}
