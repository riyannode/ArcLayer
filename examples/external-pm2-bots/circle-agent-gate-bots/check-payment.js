require("dotenv").config({ path: ".env" });

const { GatewayClient } = require("@circle-fin/x402-batching/client");
const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/$/, "");

async function main() {
  const apiKey = process.env.ARCLAYER_API_KEY;

  // 1. Read upstream oracle events
  const upstreamRes = await fetch(BASE_URL + "/api/agent-bridge/events?role=oracle&category=prediction-market-bots&limit=10", {
    headers: { authorization: "Bearer " + apiKey, accept: "application/json" },
  });
  const upstreamData = await upstreamRes.json();
  const events = (upstreamData.events || []).filter((e) => e.type === "market_snapshot");
  console.log("Upstream market_snapshot events:", events.length);
  const latest = events[0];
  const payloadHash = latest?.payload_hash;
  console.log("Latest payloadHash:", payloadHash?.slice(0, 12));

  const pk = process.env.X402_PAYER_PRIVATE_KEY;
  const client = new GatewayClient({ chain: "arcTestnet", privateKey: pk });
  console.log("Payer:", client.address);

  // 2. Post purchase intent
  const intentRes = await fetch(BASE_URL + "/api/agent-bridge/events", {
    method: "POST",
    headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "btc-15m_analyzer_1779962400",
      category: "prediction-market-bots",
      role: "analyzer",
      type: "bridge_event",
      runtimeId: "circle-commerce-analyzer-01",
      payload: {
        action: "PAY_FOR_ORACLE_ACCESS",
        buyerRole: "analyzer",
        sellerRole: "oracle",
        sellerAgentId: "hermes-oracle",
        sourcePayloadHash: payloadHash,
        market: "btc-15m",
        createdAt: new Date().toISOString(),
      },
      metadata: { commerceBuyer: true, buyerRole: "analyzer", sellerRole: "oracle", sellerAgentId: "hermes-oracle", accessType: "one_time", scope: "market_data", market: "btc-15m" },
    }),
  });
  const intentData = await intentRes.json();
  console.log("Intent posted, sessionId:", intentData.sessionId);

  // 3. Pay via commerce gate
  const body = {
    category: "prediction-market-bots",
    buyerAgentId: process.env.ARCLAYER_AGENT_ID,
    buyerRole: "analyzer",
    sellerAgentId: "hermes-oracle",
    sellerRole: "oracle",
    scope: "market_data",
    market: "btc-15m",
    sessionId: intentData.sessionId || "btc-15m_analyzer_1779962400",
    runtimeId: "circle-commerce-analyzer-01",
    payloadHash: payloadHash,
    accessType: "one_time",
    payload: { sourcePayloadHash: payloadHash, action: "PAY_FOR_ORACLE_ACCESS", sellerAgentId: "hermes-oracle", sellerRole: "oracle", buyerRole: "analyzer" },
    llmReceipt: { summary: "Mock analysis", model: "mock", decision: "BUY", provider: "mock", confidence: 0.85 },
    nonce: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
  };

  console.log("\n=== Paying commerce gate ===");
  const result = await client.pay(BASE_URL + "/api/x402/agent-commerce-gate", {
    method: "POST",
    headers: { authorization: "Bearer " + apiKey, "content-type": "application/json", accept: "application/json" },
    body,
  });

  console.log("\n--- result keys:", Object.keys(result));
  console.log("result.txHash:", result.txHash);
  console.log("result.transaction:", result.transaction);
  console.log("result.paymentId:", result.paymentId);
  console.log("\n--- result.data keys:", result.data ? Object.keys(result.data) : "null");
  console.log("data.txHash:", result.data?.txHash);
  console.log("data.transaction:", result.data?.transaction);
  console.log("data.paymentId:", result.data?.paymentId);
  console.log("data.ok:", result.data?.ok);
  console.log("data.access:", result.data?.access);
  console.log("data.settlementRail:", result.data?.settlementRail);

  // Verify on-chain
  const tHash = result.txHash || result.data?.txHash || result.data?.transaction || result.transaction;
  if (tHash && tHash.startsWith("0x")) {
    console.log("\n✅ On-chain tx:", tHash);
    console.log("ArcScan: https://testnet.arcscan.app/tx/" + tHash);
  } else {
    console.log("\n⚠ txHash is NOT an on-chain hash:", tHash);
    
    // Try to find payment-response header for on-chain tx
    if (result.headers) {
      const pr = result.headers["payment-response"] || result.headers["PAYMENT-RESPONSE"];
      if (pr) {
        console.log("PAYMENT-RESPONSE header:", pr);
      }
    }
  }
}

main().catch((e) => console.error("FAIL:", e.message || e));
