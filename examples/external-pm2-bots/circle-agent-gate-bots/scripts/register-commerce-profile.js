const path = require("node:path");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });

const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/$/, "");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function main() {
  const agentId = required("ARCLAYER_AGENT_ID");
  const apiKey = required("ARCLAYER_API_KEY");
  const payTo = String(
    process.env.SELLER_PAY_TO ||
    process.env.X402_SELLER_PAY_TO ||
    process.env.X402_PAYER_ADDRESS ||
    ""
  ).trim();

  if (!payTo) {
    throw new Error("Missing SELLER_PAY_TO / X402_SELLER_PAY_TO / X402_PAYER_ADDRESS");
  }

  const body = {
    agentId,
    payTo,
    displayName: process.env.SELLER_DISPLAY_NAME || process.env.RUNTIME_ID || null,
    category: process.env.AGENT_CATEGORY || "prediction-market-bots",
    role: process.env.AGENT_ROLE || "oracle",
    defaultScope: process.env.AGENT_SCOPE || process.env.X402_SCOPE || "market_data",
    defaultMarket: process.env.MARKET_ID || "btc-15m",
    priceAtomic: process.env.SELLER_PRICE_ATOMIC || "1",
    isActive: true,
    metadata: {
      runtimeId: process.env.RUNTIME_ID || null,
      source: "circle-agent-gate-bots",
    },
  };

  const res = await fetch(`${BASE_URL}/api/a2a/commerce-profile`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    throw new Error(`register profile failed: ${res.status} ${data.error || data.message || "unknown"}`);
  }

  console.log("[commerce-profile] registered");
}

main().catch((err) => {
  console.error("[commerce-profile] failed:", err.message);
  process.exit(1);
});
