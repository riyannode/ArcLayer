/**
 * Circle Modular Wallets — transport + client setup for Arc Testnet.
 *
 * This replaces the old wagmi/Privy config. All on-chain interactions
 * go through Circle's bundler (ERC-4337 userOps) with built-in paymaster
 * for gasless transactions.
 */
import { toModularTransport } from '@circle-fin/modular-wallets-core';
import { createPublicClient } from 'viem';
import { arcTestnet } from '@arclayer/sdk';

// Circle Modular Wallets credentials (injected at build time)
export const CIRCLE_CLIENT_KEY =
  process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY || '';
export const CIRCLE_CLIENT_URL =
  process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL || '';

/**
 * Modular transport for Arc Testnet.
 * Routes through Circle's bundler + paymaster infrastructure.
 */
export function createArcModularTransport() {
  return toModularTransport(
    `${CIRCLE_CLIENT_URL}/arcTestnet`,
    CIRCLE_CLIENT_KEY,
  );
}

/**
 * Public client connected to Arc Testnet via Circle's modular transport.
 * Use for read operations (getBalance, readContract, etc.)
 */
export function createArcPublicClient() {
  const transport = createArcModularTransport();
  return createPublicClient({
    chain: arcTestnet,
    transport,
  });
}
