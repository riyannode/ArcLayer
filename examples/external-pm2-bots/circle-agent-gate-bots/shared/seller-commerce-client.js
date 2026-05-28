const { GatewayClient } = require("@circle-fin/x402-batching/client");

const BASE_URL = (process.env.ARCLAYER_BASE_URL || process.env.ARCLAYER_API_URL || "https://arclayers.xyz").replace(/\/$/, "");

function normalizePrivateKey(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("REPLACE") || raw.includes("...")) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function getApiKey() {
  return String(process.env.ARCLAYER_API_KEY || process.env.ARCLAYER_AGENT_API_KEY || "").trim();
}

function getAgentId() {
  return String(process.env.ARCLAYER_AGENT_ID || process.env.AGENT_ID || "").trim();
}

function defaultScopeForSeller(sellerRole, accessType) {
  if (sellerRole === "oracle") return "market_data";
  if (sellerRole === "analyzer") return "analysis";
  if (sellerRole === "evaluator") return "evaluation";
  if (sellerRole === "executor") return "hft_session";
  return "hft_session";
}

async function paySellerCommerceGate({
  sellerAgentId,
  sellerRole,
  buyerRole,
  category = process.env.AGENT_CATEGORY || "prediction-market-bots",
  scope = process.env.AGENT_SCOPE || process.env.X402_SCOPE || defaultScopeForSeller(sellerRole, accessType),
  market = process.env.MARKET_ID || "btc-15m",
  sessionId,
  runtimeId = process.env.RUNTIME_ID || null,
  payloadHash,
  accessType,
  payload = {},
  llmReceipt,
}) {
  const apiKey = getApiKey();
  const buyerAgentId = getAgentId();
  const privateKey = normalizePrivateKey(process.env.X402_PAYER_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY);

  if (!apiKey) throw new Error("Missing ARCLAYER_API_KEY");
  if (!buyerAgentId) throw new Error("Missing ARCLAYER_AGENT_ID");
  if (!privateKey) throw new Error("Missing X402_PAYER_PRIVATE_KEY");
  if (!sellerAgentId) throw new Error("Missing sellerAgentId");
  if (!sellerRole) throw new Error("Missing sellerRole");
  if (!buyerRole) throw new Error("Missing buyerRole");
  if (!sessionId) throw new Error("Missing sessionId");
  if (!payloadHash) throw new Error("Missing payloadHash");
  if (!accessType) throw new Error("Missing accessType");

  const body = {
    category,
    buyerAgentId,
    buyerRole,
    sellerAgentId,
    sellerRole,
    scope,
    market,
    sessionId,
    runtimeId,
    payloadHash,
    accessType,
    payload,
    llmReceipt,
    nonce: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };

  const client = new GatewayClient({
    chain: process.env.X402_GATEWAY_CHAIN || "arcTestnet",
    privateKey,
    rpcUrl: process.env.ARC_RPC_URL || process.env.RPC_URL || undefined,
  });

  let result;
  try {
    result = await client.pay(`${BASE_URL}/api/x402/agent-commerce-gate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body,
    });
  } catch (payErr) {
    const msg = String(payErr.message || payErr);
    // already_paid = session was already settled — treat as success
    if (msg.includes("already_paid")) {
      return {
        ok: true,
        rail: "x402_circle_commerce",
        payer: client.address || null,
        paymentId: null,
        transaction: null,
        txHash: null,
        buyerAgentId,
        sellerAgentId,
        sellerRole,
        accessType,
        sessionId,
        payloadHash,
        alreadyPaid: true,
        response: { already_paid: true },
      };
    }
    // Log full error for debugging
    console.error(`[paySellerCommerceGate] FULL ERROR:`, msg);
    if (payErr.response?.data) console.error(`[paySellerCommerceGate] API response:`, JSON.stringify(payErr.response.data));
    throw payErr;
  }

  const safeResult = JSON.parse(JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  console.log(`[paySellerCommerceGate] raw result:`, JSON.stringify(safeResult, null, 2));

  const data = safeResult.data || {};
  const txHash = data.txHash || data.transaction || safeResult.txHash || safeResult.transaction || null;

  return {
    ok: true,
    rail: "x402_circle_commerce",
    payer: client.address || null,
    paymentId: data.paymentId || data.paymentResponse?.paymentId || null,
    transaction: txHash,
    txHash,
    buyerAgentId,
    sellerAgentId,
    sellerRole,
    accessType,
    sessionId: data.sessionId || sessionId,
    payloadHash: data.payloadHash || payloadHash,
    response: data,
  };
}

module.exports = {
  paySellerCommerceGate,
};
