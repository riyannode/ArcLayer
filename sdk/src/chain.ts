import { http, createPublicClient, getContract } from "viem";
import { CONTRACTS } from "./addresses";
import { MILESTONE_ESCROW_ABI } from "./abi";

export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
} as const;

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(arcTestnet.rpcUrls.default.http[0]),
});

export const milestoneEscrow = getContract({
  address: CONTRACTS.MILESTONE_ESCROW,
  abi: MILESTONE_ESCROW_ABI,
  client: publicClient,
});
