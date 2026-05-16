/**
 * Server-side wrapper around Circle BatchFacilitatorClient.
 *
 * Lazily instantiates the Circle Gateway facilitator and exposes a thin
 * surface (verify / settle / supported / isBatchPayment passthrough) so the
 * route handlers in /api/x402/* don't have to touch the SDK directly.
 *
 * NOTE: Arc Testnet is on Circle's supported chain list as `arcTestnet`,
 * but this codepath is gated behind `X402_GATEWAY_ENABLED=true` until a real
 * Gateway payment succeeds end-to-end on Arc Testnet. Until then, every
 * payload is routed through the self-hosted relayer in `settle-exact.ts`.
 */

import {
  BatchFacilitatorClient,
  isBatchPayment as sdkIsBatchPayment,
} from '@circle-fin/x402-batching/server';
import { CHAIN_CONFIGS } from '@circle-fin/x402-batching/client';
import {
  GATEWAY_CHAIN_CONFIG_KEY,
  GATEWAY_FACILITATOR_URL_MAINNET,
  GATEWAY_FACILITATOR_URL_TESTNET,
  GATEWAY_NETWORK_NAME,
} from '../constants';

let cached: BatchFacilitatorClient | null = null;

/** Returns true when the operator has explicitly enabled Gateway routing. */
export function isGatewayEnabled(): boolean {
  return process.env.X402_GATEWAY_ENABLED === 'true';
}

/** Resolve the Gateway facilitator URL — testnet by default. */
export function gatewayFacilitatorUrl(): string {
  if (process.env.X402_GATEWAY_FACILITATOR_URL) {
    return process.env.X402_GATEWAY_FACILITATOR_URL;
  }
  return process.env.X402_GATEWAY_NETWORK === 'mainnet'
    ? GATEWAY_FACILITATOR_URL_MAINNET
    : GATEWAY_FACILITATOR_URL_TESTNET;
}

/** Lazy singleton — avoids import-time work in cold serverless lambdas. */
export function getBatchFacilitatorClient(): BatchFacilitatorClient {
  if (cached) return cached;
  cached = new BatchFacilitatorClient({ url: gatewayFacilitatorUrl() });
  return cached;
}

/**
 * Detect whether a PaymentRequirements-like object should be routed to the
 * Circle Gateway facilitator. Detection is based on `extra.name` /
 * `extra.version` per the Circle SDK contract.
 */
export function isBatchPayment(requirements: { extra?: Record<string, unknown> } | null | undefined): boolean {
  if (!requirements) return false;
  return sdkIsBatchPayment(requirements);
}

export function getArcTestnetGatewayConfig() {
  const config = CHAIN_CONFIGS[GATEWAY_CHAIN_CONFIG_KEY];
  if (!config) throw new Error(`Circle x402 batching SDK has no chain config for ${GATEWAY_CHAIN_CONFIG_KEY}`);
  return config;
}

export async function probeGatewayRuntimeSupport() {
  const client = getBatchFacilitatorClient();
  const supported = await client.getSupported();
  const kinds = Array.isArray(supported.kinds) ? supported.kinds : [];
  const arcKinds = kinds.filter((kind) => kind.network === GATEWAY_NETWORK_NAME || kind.network === GATEWAY_CHAIN_CONFIG_KEY);
  const config = getArcTestnetGatewayConfig();
  return {
    ok: arcKinds.length > 0,
    expected: { supportedChainName: GATEWAY_CHAIN_CONFIG_KEY, domain: 26, nanopayments: true },
    sdkConfig: {
      chainId: config.chain.id,
      domain: config.domain,
      usdc: config.usdc,
      gatewayWallet: config.gatewayWallet,
      gatewayMinter: config.gatewayMinter,
    },
    runtime: {
      url: gatewayFacilitatorUrl(),
      arcKinds,
      kindsCount: kinds.length,
      extensions: supported.extensions ?? [],
      signers: supported.signers ?? {},
    },
  };
}
