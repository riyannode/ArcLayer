import { http, fallback, createPublicClient, getContract } from "viem";
import { CONTRACTS } from "./addresses";
import {
  AGENT_REGISTRY_ABI,
  JOB_ESCROW_ABI,
  MILESTONE_ESCROW_ABI,
  REPUTATION_ORACLE_ABI,
  WORK_PROOF_ABI,
} from "./abi";

export const ARC_RPC_URLS = [
  "https://rpc.testnet.arc.network",
  "https://rpc.blockdaemon.testnet.arc.network",
  "https://rpc.drpc.testnet.arc.network",
  "https://rpc.quicknode.testnet.arc.network",
] as const;

export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [...ARC_RPC_URLS] },
    public: { http: [...ARC_RPC_URLS] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
} as const;

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(ARC_RPC_URLS.map((url) => http(url))),
});

export const milestoneEscrow = getContract({
  address: CONTRACTS.MILESTONE_ESCROW,
  abi: MILESTONE_ESCROW_ABI,
  client: publicClient,
});

export const agentRegistry = getContract({
  address: CONTRACTS.AGENT_REGISTRY,
  abi: AGENT_REGISTRY_ABI,
  client: publicClient,
});

export const jobEscrow = getContract({
  address: CONTRACTS.JOB_ESCROW,
  abi: JOB_ESCROW_ABI,
  client: publicClient,
});

export const workProof = getContract({
  address: CONTRACTS.WORK_PROOF,
  abi: WORK_PROOF_ABI,
  client: publicClient,
});

export const reputationOracle = getContract({
  address: CONTRACTS.REPUTATION_ORACLE,
  abi: REPUTATION_ORACLE_ABI,
  client: publicClient,
});
