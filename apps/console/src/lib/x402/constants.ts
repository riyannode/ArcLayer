export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const ARC_TESTNET_NETWORK = 'arc-testnet' as const;
export const ARC_TESTNET_CAIP2_NETWORK = 'eip155:5042002' as const;
export const X402_VERSION = 1 as const;
export const X402_VERSION_V2 = 2 as const;

export const JOB_ESCROW_ADDRESS = '0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225' as const;
export const WORK_PROOF_ADDRESS = '0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5' as const;
export const REPUTATION_ORACLE_ADDRESS = '0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c' as const;
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
