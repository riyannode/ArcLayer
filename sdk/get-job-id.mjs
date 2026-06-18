import { createPublicClient, http, parseAbi, decodeEventLog } from "viem";
const ARC_CHAIN = { id: 5042002, name: "Arc Testnet", rpcUrls: { default: { http: ["https://rpc.drpc.testnet.arc.network"] } }, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 } };
const pc = createPublicClient({ chain: ARC_CHAIN, transport: http("https://rpc.drpc.testnet.arc.network") });

const receipt = await pc.getTransactionReceipt({ hash: "0x2749e4d2bd7ba586d785c27d60f6b3eb70156d9e3e2dd5b9ecaf12a60934d4fa" });
console.log("status:", receipt.status);

// Try to decode with AgenticCommerce ABI
const abi = parseAbi([
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, string description, address hook)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
for (const log of receipt.logs) {
  try {
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
    console.log("decoded:", JSON.stringify(decoded));
  } catch {
    console.log("raw log:", log.address, log.topics, log.data?.slice(0, 130));
  }
}
