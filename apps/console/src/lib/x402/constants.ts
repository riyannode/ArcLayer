export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_TESTNET_NETWORK = 'arc-testnet' as const;
export const ARC_TESTNET_CAIP2_NETWORK = 'eip155:5042002' as const;
export const X402_VERSION = 1 as const;
export const X402_VERSION_V2 = 2 as const;

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;

export const X_PAYMENT_HEADER = 'X-PAYMENT' as const;
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED' as const;
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE' as const;

export const DEFAULT_REQUIREMENT_TTL_SECONDS = 300;
export const DEFAULT_RESPONSE_CACHE_TTL_SECONDS = 86400;
export const DEFAULT_VERIFY_TIMEOUT_MS = 10000;

// Circle Gateway Batching
export const GATEWAY_CHAIN_CONFIG_KEY = 'arcTestnet' as const;
export const GATEWAY_NETWORK_NAME = ARC_TESTNET_CAIP2_NETWORK;
export const GATEWAY_FACILITATOR_URL_TESTNET = 'https://gateway-api-testnet.circle.com' as const;
export const GATEWAY_FACILITATOR_URL_MAINNET = 'https://gateway-api.circle.com' as const;
export const CIRCLE_BATCHING_NAME = 'GatewayWalletBatched' as const;
export const CIRCLE_BATCHING_VERSION = '1' as const;
export const GATEWAY_WALLET_ADDRESS = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;
export const DEFAULT_GATEWAY_DEPOSIT_USDC = '1.00' as const;

/**
 * x402 payment amounts use ERC-20 USDC (6 decimals).
 * Example: amount "10000" = 0.01 USDC.
 *
 * The native gas interface (msg.value, getBalance) uses 18 decimals.
 * x402 never touches native gas — it only uses EIP-3009 TransferWithAuthorization
 * on the ERC-20 USDC contract (0x3600...).
 */
export const X402_USDC_DECIMALS = 6;
