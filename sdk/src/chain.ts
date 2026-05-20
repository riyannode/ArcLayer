import { http, fallback, createPublicClient, getContract } from "viem";
import { ARC_EXPLORER, ARC_RPC_URLS, CONTRACTS } from "./addresses";
import {
  ERC8004_IDENTITY_REGISTRY_ABI,
  ERC8183_AGENTIC_COMMERCE_ABI,
  USDC_ABI,
} from "./abi";

export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  // Arc native gas token is USDC. Native interface uses 18 decimals
  // (vs ERC-20 USDC 6 decimals). See ARC_NATIVE_USDC_DECIMALS in addresses.ts.
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [...ARC_RPC_URLS] },
    public: { http: [...ARC_RPC_URLS] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: ARC_EXPLORER },
  },
} as const;

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(ARC_RPC_URLS.map((url) => http(url))),
});

/** Official ERC-8004 Identity Registry on Arc Testnet. */
export const erc8004IdentityRegistry = getContract({
  address: CONTRACTS.ERC8004_IDENTITY_REGISTRY,
  abi: ERC8004_IDENTITY_REGISTRY_ABI,
  client: publicClient,
});

/** Official ERC-8183 Agentic Commerce on Arc Testnet. */
export const erc8183AgenticCommerce = getContract({
  address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
  abi: ERC8183_AGENTIC_COMMERCE_ABI,
  client: publicClient,
});

/** Arc ERC-20 USDC interface — 6 decimals. */
export const usdc = getContract({
  address: CONTRACTS.USDC,
  abi: USDC_ABI,
  client: publicClient,
});

// Legacy aliases during migration. These now point to official Arc contracts.
/** @deprecated Use erc8004IdentityRegistry. */
export const agentRegistry = erc8004IdentityRegistry;
/** @deprecated Use erc8183AgenticCommerce. */
export const jobEscrow = erc8183AgenticCommerce;
/** @deprecated No WorkProof in official Arc/Circle reference mode. */
export const workProof = undefined;
/** @deprecated No ReputationOracle in official Arc/Circle reference mode. */
export const reputationOracle = undefined;
/** @deprecated No MilestoneEscrow in official Arc/Circle reference mode. */
export const milestoneEscrow = undefined;
