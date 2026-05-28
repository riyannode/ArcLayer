const path = require("node:path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const { GatewayClient } = require("@circle-fin/x402-batching/client");

function normalizePrivateKey(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("ISI_") || raw.includes("REPLACE")) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

async function main() {
  const privateKey = normalizePrivateKey(process.env.X402_PAYER_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY);
  if (!privateKey) throw new Error("Missing X402_PAYER_PRIVATE_KEY or WALLET_PRIVATE_KEY");

  const amount = process.env.X402_GATEWAY_DEPOSIT_AMOUNT || "1.00";

  const client = new GatewayClient({
    chain: process.env.X402_GATEWAY_CHAIN || "arcTestnet",
    privateKey,
    rpcUrl: process.env.ARC_RPC_URL || process.env.RPC_URL || undefined,
  });

  console.log("[gateway] address:", client.address || "(unknown)");

  if (typeof client.getBalances === "function") {
    const before = await client.getBalances();
    console.log("[gateway] before:", JSON.stringify(before, null, 2));
  }

  if (typeof client.deposit !== "function") {
    throw new Error("GatewayClient.deposit() not found. Inspect @circle-fin/x402-batching client API and adjust this script.");
  }

  const result = await client.deposit(amount);
  console.log("[gateway] deposit result:", JSON.stringify(result, null, 2));

  if (typeof client.getBalances === "function") {
    const after = await client.getBalances();
    console.log("[gateway] after:", JSON.stringify(after, null, 2));
  }
}

main().catch((err) => {
  console.error("[gateway] deposit failed:", err.message);
  process.exit(1);
});
