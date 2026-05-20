export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const ARC_CHAIN_ID = 5042002;
export const ARC_EXPLORER = "https://testnet.arcscan.app";

/**
 * Canonical RPC endpoints for Arc Testnet.
 * Primary: rpc.testnet.arc.network (Circle canonical)
 * Fallbacks: dRPC, QuickNode, Blockdaemon
 */
export const ARC_RPC_URLS = [
  "https://rpc.testnet.arc.network",
  "https://rpc.drpc.testnet.arc.network",
  "https://rpc.quicknode.testnet.arc.network",
  "https://rpc.blockdaemon.testnet.arc.network",
] as const;

/**
 * USDC decimal model on Arc.
 *
 * Arc uses USDC as native gas token with TWO interfaces:
 * - Native (gas/balance): 18 decimals — used by msg.value, native balance, gas estimation.
 * - ERC-20 (token contract 0x3600...): 6 decimals — used by transfer/approve/escrow/x402.
 *
 * NEVER mix raw values from the two interfaces without converting.
 * Ref: https://docs.arc.io/arc/references/gas-and-fees.md
 */
export const ARC_NATIVE_USDC_DECIMALS = 18;
export const ARC_ERC20_USDC_DECIMALS = 6;

/**
 * CCTP (Cross-Chain Transfer Protocol) domain for Arc.
 * Used for bridging USDC via Circle's CCTP / App Kit.
 * Ref: https://docs.arc.io/arc/references/contract-addresses.md
 */
export const ARC_CCTP_DOMAIN = 26;

/**
 * Token addresses on Arc Testnet.
 */
export const ARC_TOKENS = {
  /** USDC ERC-20 — 6 decimals, used for approve/transfer/escrow */
  USDC: "0x3600000000000000000000000000000000000000",
  /** EURC ERC-20 — Euro stablecoin on Arc */
  EURC: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4",
} as const;

/**
 * Official Arc reference contracts deployed by Circle on Arc Testnet.
 *
 * ERC-8004: Agent Identity Registry — register AI agents on-chain.
 * ERC-8183: Agentic Commerce — create jobs, fund, submit, complete.
 *
 * These are the ONLY contracts used for agent identity and job flows.
 * Source: https://docs.arc.io/arc/references/contract-addresses.md
 */
export const CONTRACTS = {
  /** ERC-8004 IdentityRegistry — register(string metadataURI) → tokenId */
  ERC8004_IDENTITY_REGISTRY: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  /** ERC-8183 AgenticCommerce — createJob/setBudget/fund/submit/complete */
  ERC8183_AGENTIC_COMMERCE: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  /** USDC ERC-20 token (6 decimals) */
  USDC: "0x3600000000000000000000000000000000000000",

  /** @deprecated Use ERC8004_IDENTITY_REGISTRY. Kept only until UI/indexer migration is complete. */
  AGENT_REGISTRY: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  /** @deprecated Use ERC8183_AGENTIC_COMMERCE. Kept only until UI/indexer migration is complete. */
  JOB_ESCROW: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  /** @deprecated Official Arc/Circle reference mode has no ArcLayer WorkProof contract. */
  WORK_PROOF: ZERO_ADDRESS,
  /** @deprecated Official Arc/Circle reference mode has no ArcLayer ReputationOracle contract. */
  REPUTATION_ORACLE: ZERO_ADDRESS,
  /** @deprecated Disabled in official Arc/Circle reference mode. */
  ACHIEVEMENT: ZERO_ADDRESS,
  /** @deprecated Disabled in official Arc/Circle reference mode. */
  INVOICE: ZERO_ADDRESS,
  /** @deprecated Disabled in official Arc/Circle reference mode. */
  SUBSCRIPTION: ZERO_ADDRESS,
  /** @deprecated Disabled in official Arc/Circle reference mode. */
  MILESTONE_ESCROW: ZERO_ADDRESS,
} as const;

/**
 * Legacy alias — kept for backward compat during migration.
 * @deprecated Use CONTRACTS directly.
 */
export const ARC_REFERENCE_CONTRACTS = CONTRACTS;

/**
 * A2A (Agent-to-Agent) stack — separate registry track.
 * These are ArcLayer's own A2A protocol contracts for autonomous agent
 * discovery, receipts, reputation, and market mirroring.
 * They coexist with official Arc contracts on testnet.
 */
export const A2A_CONTRACTS = {
  A2A_AGENT_REGISTRY: "0xB263336055dD65FF501e36CA39941760D943703C",
  A2A_REPUTATION_REGISTRY: "0x9c97CAE866397d94e295632B3BFCF342ea20f1Cc",
  A2A_RECEIPT_REGISTRY: "0x5F591465D0C2fe20A28D2539dFBB2B00716397B7",
  MARKET_MIRROR_REGISTRY: "0xec5910926925941c451C97A8bd2c4Ba7bD173195",
  IGNIA: "0xd66971F9Da4c60DB4A061686F43dBf39Db5E2916",
  AGENT_REGISTRY_V2: "0x0465CeBC34698Aa156bcBB8d5c1caA39777dDb58",
} as const;
